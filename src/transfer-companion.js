export const TRANSFER_DELAY_MS = 10_000;
export const TRANSFER_HOLD_MESSAGE = "I’m getting someone ready to take your call. Please hold for just a moment.";

export function transferSummary(tenant, lead = {}, callerNumber = '') {
  const clean = (value, max) => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, max) : '';
  const lines = [`BookedRadar transfer — ${clean(tenant.businessName, 120) || 'Business'}`];
  for (const [label, value, max] of [
    ['Caller', lead.name, 120], ['Service', lead.service_type, 180],
    ['Urgency', lead.urgency, 120], ['Preferred timing', lead.preferred_window, 180],
    ['Service address', lead.service_address, 240], ['City', lead.city, 120],
    ['Callback', lead.callback_number || callerNumber, 40],
  ]) {
    const text = clean(value, max);
    if (text) lines.push(`${label}: ${text}`);
  }
  return lines.join('\n');
}

// This is an internal human handoff notification, independent of customer campaigns.
// Do not retry ambiguous SMS requests: a timeout must not produce duplicate texts.
export function createTransferCompanion({ config, log, fetchImpl = fetch,
  schedule = setTimeout, cancel = clearTimeout, now = () => performance.now(), smsTimeoutMs = 8000 }) {
  const ready = () => Boolean(/^AC[\da-f]{32}$/i.test(config.accountSid || '') && config.authToken && /^\+[1-9]\d{7,14}$/.test(config.fromNumber || ''));
  async function notifyAndWait({ callId, tenant, target, lead, callerNumber }) {
    const emit = (event, fields = {}) => log(`transfer.${event}`, { call_id: callId, tenant_id: tenant.tenantId, ...fields });
    emit('sms_requested');
    const abort = new AbortController();
    let timeout, reason = 'sms_request_failed';
    try {
      if (!ready()) { reason = 'sms_not_configured'; throw new Error(reason); }
      await Promise.race([
        (async () => {
          const response = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`, {
            method: 'POST', signal: abort.signal,
            headers: { Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ To: target, From: config.fromNumber, Body: transferSummary(tenant, lead, callerNumber) }),
          });
          if (!response.ok) throw new Error('sms_request_failed');
          const result = await response.json();
          if (!/^SM[\da-f]{32}$/i.test(result.sid || '') || !['accepted', 'queued', 'sending', 'sent', 'delivered'].includes(result.status)) throw new Error('sms_request_failed');
        })(),
        new Promise((_, reject) => { timeout = schedule(() => {
          reason = 'sms_request_timeout'; abort.abort(); reject(new Error(reason));
        }, smsTimeoutMs); }),
      ]);
      // Sent means provider acceptance, not confirmed handset delivery.
      emit('sms_sent', { acceptance: 'provider_accepted' });
    } catch { emit('sms_failed', { reason }); }
    finally { cancel(timeout); }
    const started = now();
    emit('delay_started', { delay_ms: TRANSFER_DELAY_MS });
    await new Promise(resolve => schedule(resolve, TRANSFER_DELAY_MS));
    emit('delay_complete', { delay_ms: TRANSFER_DELAY_MS, elapsed_ms: Math.round(now() - started) });
  }
  return { ready, notifyAndWait };
}

// Keep the existing SIP media leg alive during the SMS request, delay and REFER.
// Only transfer-time VAD is paused; the original session settings are restored
// if REFER fails. Playback events (not generation completion) control replenishment.
export function createTransferHold({ send: deliver, log, schedule = setTimeout, cancel = clearTimeout }) {
  let active = false, timer, responseId, originalVad, playing = false, requestNumber = 0;
  const tag = 'bookedradar_transfer_hold';
  function send(event) {
    try { deliver(event); }
    catch { log('transfer.hold_failed', { reason: 'sideband_unavailable' }); }
  }
  function request() {
    if (!active) return;
    playing = false;
    responseId = undefined;
    requestNumber++;
    send({ type: 'response.create', response: {
      conversation: 'none', input: [], output_modalities: ['audio'], tools: [], tool_choice: 'none',
      metadata: { purpose: tag, sequence: String(requestNumber) },
      instructions: `Read this holding announcement exactly, calmly and continuously, without asking questions or adding facts: "${TRANSFER_HOLD_MESSAGE} Thank you for staying on the line. Please keep the line open while I arrange your transfer. I’m still here with you, and I’ll connect your call shortly. Thank you for your patience."`,
    } });
    cancel(timer);
    timer = schedule(() => {
      if (!active || playing) return;
      log('transfer.hold_retry');
      if (responseId) send({ type: 'response.cancel', response_id: responseId });
      request();
    }, 3000);
  }
  return {
    start() {
      if (active) return;
      active = true;
      if (originalVad) send({ type: 'session.update', session: { type: 'realtime', audio: { input: { turn_detection: { ...originalVad, create_response: false, interrupt_response: false } } } } });
      send({ type: 'response.cancel' });
      log('transfer.hold_requested');
      request();
    },
    event(event) {
      if (!active && ['session.created', 'session.updated'].includes(event.type)) originalVad = event.session?.audio?.input?.turn_detection;
      if (event.type === 'response.created' && event.response?.metadata?.purpose === tag) {
        if (!active || event.response.metadata.sequence !== String(requestNumber)) {
          send({ type: 'response.cancel', response_id: event.response.id });
          return;
        }
        responseId = event.response.id;
      }
      if (!active || !responseId || event.response_id !== responseId) return;
      if (event.type === 'output_audio_buffer.started') {
        playing = true; cancel(timer); log('transfer.hold_audio');
      }
      if (['output_audio_buffer.stopped', 'output_audio_buffer.cleared'].includes(event.type)) request();
    },
    stop({ restore = false } = {}) {
      if (!active) return;
      active = false; cancel(timer);
      if (restore) {
        if (responseId) send({ type: 'response.cancel', response_id: responseId });
        send({ type: 'output_audio_buffer.clear' });
        if (originalVad) send({ type: 'session.update', session: { type: 'realtime', audio: { input: { turn_detection: originalVad } } } });
      }
    },
  };
}
