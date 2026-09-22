import crypto from 'node:crypto';
import express from 'express';

const xml = value => String(value ?? '').replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
const response = body => `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
const say = text => `<Say>${xml(text)}</Say>`;
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const sidValid = value => /^CA[0-9a-f]{32}$/i.test(value || '');

export function validTwilioSignature({ token, url, body, signature }) {
  if (!token || !signature) return false;
  let payload = url;
  for (const key of Object.keys(body).sort()) {
    if (typeof body[key] !== 'string') return false;
    payload += key + body[key];
  }
  return equal(crypto.createHmac('sha1', token).update(payload).digest('base64'), signature);
}

export function whisperText(tenant, lead = {}) {
  const safe = (value, n = 220) => String(value || 'Not collected').replace(/[\x00-\x1f]/g, ' ').slice(0, n);
  return `This is a BookedRadar transfer for ${safe(tenant.businessName, 120)}. ` +
    `Caller: ${safe(lead.name, 120)}. Service or problem: ${safe(lead.service_type)}. ` +
    `Urgency: ${safe(lead.urgency, 120)}. Timing: ${safe(lead.preferred_window, 180)}. ` +
    'Press 1 to accept the call. Press any other key to decline.';
}

export function createWarmTransfer({ store, registry, config, log, now = Date.now }) {
  const locks = new Map();
  const revoked = new Set();
  async function serialized(id, fn) {
    const previous = locks.get(id) || Promise.resolve();
    const next = previous.catch(() => {}).then(fn);
    locks.set(id, next);
    try { return await next; } finally { if (locks.get(id) === next) locks.delete(id); }
  }
  const ready = () => Boolean(config.enabled && /^([a-z0-9-]+\.)+sip\.twilio\.com$/i.test(config.domain || '') &&
    /^https:\/\/[^/?#]+$/.test(config.baseUrl || '') && /^AC[0-9a-f]{32}$/i.test(config.accountSid || '') && config.authToken && /^\+[1-9]\d{7,14}$/.test(config.callerId || ''));
  const preflight = () => ({ ready: ready(), reason: !config.enabled ? 'screening_disabled' : ready() ? 'configured' : 'relay_configuration_invalid' });
  const signedPath = (record, action) => {
    const path = `/voice/transfer/${record.id}/${action}`;
    const signature = crypto.createHmac('sha256', record.secret).update(path).digest('hex');
    return `${config.baseUrl}${path}?sig=${signature}`;
  };
  async function emit(record, status, patch = {}) {
    const current = await store.getCall(record.id);
    const seen = current?.events || [];
    await store.patchCall(record.id, { ...patch, events: [...new Set([...seen, status])] });
    if (!seen.includes(status)) log(`transfer.${status}`, { call_id: record.callId, tenant_id: record.tenantId, transfer_id: record.id });
  }
  function fallbackXml(record) {
    return response(say(record.leadSaved
      ? "I'm sorry, the team is unavailable right now. Your information has been saved for follow-up. Thank you for calling. Goodbye."
      : "I'm sorry, we're having trouble connecting your call. Please call the business again. Thank you. Goodbye.") + '<Hangup/>');
  }
  async function start({ callId, tenant, target, lead, leadSaved, kind = 'transfer' }) {
    if (!ready()) throw new Error('warm_transfer_not_ready');
    if (kind === 'transfer' && !/^\+[1-9]\d{7,14}$/.test(target || '')) throw new Error('invalid_transfer_target');
    const id = crypto.randomBytes(16).toString('hex');
    const secret = crypto.randomBytes(24).toString('hex');
    const record = { id, secret, callId, tenantId: tenant.tenantId, target, lead, leadSaved,
      kind, expiresAt: now() + 24 * 60 * 60_000, entryExpiresAt: now() + 60_000, status: 'requested', events: [] };
    await store.patchCall(id, record);
    if (kind === 'greeting_fallback') await emit(record, 'requested');
    return { id, targetUri: `sip:br-${id}-${secret}@${config.domain};transport=tls` };
  }
  async function failed(id) {
    const record = await store.getCall(id);
    if (record) await emit(record, 'failed', { status: 'failed' });
  }
  const router = express.Router();
  router.use(express.urlencoded({ extended: false, limit: '32kb' }));
  router.use((req, res, next) => {
    if (!ready()) return res.sendStatus(503);
    if (req.body?.AccountSid !== config.accountSid || !validTwilioSignature({
      token: config.authToken, url: config.baseUrl + req.originalUrl, body: req.body,
      signature: req.get('X-Twilio-Signature'),
    })) return res.sendStatus(403);
    next();
  });
  router.post('/entry', async (req, res) => {
    const match = String(req.body.To || '').match(/^sips?:br-([a-f0-9]{32})-([a-f0-9]{48})@/);
    if (!match || !sidValid(req.body.CallSid)) return res.sendStatus(403);
    await serialized(match[1], async () => {
      let record = await store.getCall(match[1]);
      if (revoked.has(match[1]) || !record || !equal(record.secret, match[2]) || now() > record.entryExpiresAt || record.status === 'failed' ||
        (record.parentSid && record.parentSid !== req.body.CallSid)) return res.sendStatus(403);
      const tenant = registry.resolve({ tenantId: record.tenantId });
      if (!tenant) return res.sendStatus(403);
      if (record.entryXml) return res.type('text/xml').send(record.entryXml);
      if (record.kind === 'greeting_fallback') {
        await emit(record, 'fallback', { parentSid: req.body.CallSid, status: 'fallback' });
        const body = fallbackXml(record);
        await store.patchCall(record.id, { entryXml: body });
        return res.type('text/xml').send(body);
      }
      await emit(record, 'dialing', { parentSid: req.body.CallSid, status: 'dialing' });
      // Say answers the relay immediately: trunk REFER does not support early media.
      const body = response(say('Please hold while I try to connect you to the team.') +
        `<Dial callerId="${xml(config.callerId)}" answerOnBridge="true" ringTone="us" timeout="25" action="${xml(signedPath(record, 'complete'))}" method="POST">` +
        `<Number url="${xml(signedPath(record, 'screen'))}" method="POST" ` +
        `statusCallback="${xml(signedPath(record, 'status'))}" statusCallbackMethod="POST" ` +
        `statusCallbackEvent="initiated ringing answered completed">${xml(record.target)}</Number></Dial>`);
      await store.patchCall(record.id, { entryXml: body });
      res.type('text/xml').send(body);
    });
  });
  router.post('/:id/:action', async (req, res) => serialized(req.params.id, async () => {
    let record = await store.getCall(req.params.id);
    if (!record || record.expiresAt < now()) return res.sendStatus(403);
    const action = req.params.action;
    if (!['screen', 'accept', 'status', 'complete'].includes(action)) return res.sendStatus(404);
    const expected = new URL(signedPath(record, action)).searchParams.get('sig');
    if (!equal(expected, req.query.sig)) return res.sendStatus(403);
    if (!record.parentSid) return res.sendStatus(403);
    const body = req.body;
    if (action === 'complete') {
      if (body.CallSid !== record.parentSid || (record.childSid && body.DialCallSid !== record.childSid)) return res.sendStatus(403);
      if (body.DialBridged === 'true' && record.status === 'accepted') {
        await emit(record, 'bridged', { status: 'bridged' });
        return res.type('text/xml').send(response('<Hangup/>'));
      }
      if (record.status === 'bridged') return res.type('text/xml').send(response('<Hangup/>'));
      const status = ['no-answer', 'busy', 'canceled'].includes(body.DialCallStatus) ? 'no_answer' : 'failed';
      if (record.status !== 'rejected') await emit(record, status);
      await emit(record, 'fallback', { status: 'fallback' });
      return res.type('text/xml').send(fallbackXml(record));
    }
    if (!sidValid(body.CallSid) || body.ParentCallSid !== record.parentSid ||
      (record.childSid && body.CallSid !== record.childSid)) return res.sendStatus(403);
    if (!record.childSid) {
      await store.patchCall(record.id, { childSid: body.CallSid });
      record = await store.getCall(record.id);
    }
    if (action === 'status') {
      const mapped = { initiated: 'dialing', queued: 'dialing', ringing: 'ringing', 'in-progress': 'answered',
        busy: 'no_answer', 'no-answer': 'no_answer', failed: 'failed', canceled: 'no_answer' }[body.CallStatus];
      if (mapped) await emit(record, mapped);
      return res.sendStatus(204);
    }
    if (action === 'screen') {
      if (['rejected', 'fallback', 'failed', 'bridged'].includes(record.status)) return res.type('text/xml').send(response('<Hangup/>'));
      await emit(record, 'answered');
      const tenant = registry.resolve({ tenantId: record.tenantId });
      if (!tenant) return res.sendStatus(403);
      const bodyXml = response(`<Gather input="dtmf" numDigits="1" timeout="8" actionOnEmptyResult="true" action="${xml(signedPath(record, 'accept'))}" method="POST">` +
        say(whisperText(tenant, record.lead)) + '</Gather><Hangup/>');
      return res.type('text/xml').send(bodyXml);
    }
    if (['rejected', 'fallback', 'failed', 'bridged'].includes(record.status)) return res.type('text/xml').send(response('<Hangup/>'));
    if (now() > record.entryExpiresAt + 120_000 && record.status !== 'accepted') return res.type('text/xml').send(response('<Hangup/>'));
    if (body.Digits === '1') {
      await emit(record, 'accepted', { status: 'accepted' });
      return res.type('text/xml').send(response(say('Connecting you now.')));
    }
    if (record.status === 'accepted') return res.type('text/xml').send(response(''));
    await emit(record, 'rejected', { status: 'rejected' });
    return res.type('text/xml').send(response(say('The call was not connected. Goodbye.') + '<Hangup/>'));
  }));
  async function waitForEntry(id, timeoutMs = 8000) {
    const until = Date.now() + timeoutMs;
    do {
      const record = await store.getCall(id);
      if (record?.parentSid && record.entryXml) return true;
      if (!record || revoked.has(id) || record.status === 'failed') return false;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < until);
    return false;
  }
  async function cancelPending(id) {
    return serialized(id, async () => {
      const record = await store.getCall(id);
      // Entry and cancellation share a lock: a late SIP leg cannot start a second dial.
      if (record?.parentSid) return false;
      revoked.add(id);
      if (record) await emit(record, 'failed', { status: 'failed' });
      return true;
    });
  }
  return { ready, preflight, start, failed, waitForEntry, cancelPending, router };
}

// REFER acceptance is not proof that Twilio reached the relay. Keep call control
// until the signed entry callback arrives, or invalidate the relay before fallback.
export function createTransferController({ relay, refer, log, timeoutMs = 8000 }) {
  const calls = new Map();
  async function bounded(work) {
    let timer;
    try {
      return await Promise.race([Promise.resolve().then(work), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('transfer_step_timeout')), timeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  }
  async function run({ callId, tenant, target, prepare }) {
    const fields = { call_id: callId, tenant_id: tenant.tenantId };
    const emit = (event, extra = {}) => log(`transfer.${event}`, { ...fields, ...extra });
    emit('requested');
    let transfer, leadSaved = false;
    let reason = 'preparation_failed';
    try {
      if (!/^\+[1-9]\d{7,14}$/.test(target || '')) throw new Error('invalid_target');
      const check = relay.preflight();
      emit('preflight', { ...check, fallback_ready: true });
      const lead = await bounded(prepare);
      leadSaved = true;
      reason = check.reason;
      if (check.ready) {
        reason = 'relay_start_failed';
        transfer = await bounded(() => relay.start({ callId, tenant, target, lead, leadSaved }));
        await bounded(() => refer({ callId, targetUri: transfer.targetUri }));
        emit('relay_referred');
        if (await bounded(() => relay.waitForEntry(transfer.id, Math.max(100, timeoutMs - 100)))) {
          return { ok: true, transferred: true, lead_saved: true, status: 'screening_started', transferId: transfer.id };
        }
        reason = 'relay_entry_timeout';
      }
    } catch {
      emit('failed', { reason });
    }
    if (transfer) {
      // Revoke before attempting legacy REFER, including after ambiguous API timeouts.
      if (!await relay.cancelPending(transfer.id)) {
        return { ok: true, transferred: true, lead_saved: leadSaved, status: 'screening_started', transferId: transfer.id };
      }
    }
    emit('fallback_refer', { reason });
    try {
      await bounded(() => refer({ callId, targetUri: `tel:${target}` }));
      emit('referred', { mode: 'legacy' });
      return { ok: true, transferred: true, lead_saved: leadSaved, status: 'legacy_referred' };
    } catch {
      emit('failed', { reason: 'legacy_refer_failed' });
      return { ok: false, transferred: false, lead_saved: leadSaved, reason: 'legacy_refer_failed' };
    }
  }
  return options => {
    if (calls.has(options.callId)) return calls.get(options.callId);
    const work = run(options);
    calls.set(options.callId, work);
    work.finally(() => {
      const cleanup = setTimeout(() => calls.delete(options.callId), 60000);
      cleanup.unref?.();
    }).catch(() => {});
    return work;
  };
}
