import crypto from 'node:crypto';
import express from 'express';
import { trackedRoutes } from './tracked-routes.js';

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

export function createWarmTransfer({ store, registry, config, log, now = Date.now, trackWork = (_kind, run) => run() }) {
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
  async function start({ callId, tenant, target, lead, leadSaved, kind = 'transfer', signal }) {
    signal?.throwIfAborted();
    if (!ready()) throw new Error('warm_transfer_not_ready');
    if (kind === 'transfer' && !/^\+[1-9]\d{7,14}$/.test(target || '')) throw new Error('invalid_transfer_target');
    const id = crypto.randomBytes(16).toString('hex');
    const secret = crypto.randomBytes(24).toString('hex');
    const ticket = { id, targetUri: `sip:br-${id}-${secret}@${config.domain};transport=tls` };
    const record = { id, secret, callId, tenantId: tenant.tenantId, target, lead, leadSaved,
      kind, expiresAt: now() + 24 * 60 * 60_000, entryExpiresAt: now() + 60_000, status: 'requested', events: [] };
    // Fence entry immediately when the controller abandons a slow store write.
    // Keep the ticket available for bounded cleanup, even if the write finishes late.
    const revoke = () => revoked.add(id);
    signal?.addEventListener('abort', revoke, { once: true });
    try {
      await store.patchCall(id, record);
      if (signal?.aborted) revoke();
    } catch {
      // A rejected persistence acknowledgment may still have written the ticket.
      // Preserve its identity so the controller can revoke it before fallback.
      revoke();
      const error = new Error('relay_start_failed');
      error.transferTicket = ticket;
      throw error;
    } finally { signal?.removeEventListener('abort', revoke); }
    if (kind === 'greeting_fallback') await emit(record, 'requested');
    return ticket;
  }
  async function failed(id) {
    const record = await store.getCall(id);
    if (record) await emit(record, 'failed', { status: 'failed' });
  }
  const router = express.Router();
  const routes = trackedRoutes(router, trackWork);
  router.use(express.urlencoded({ extended: false, limit: '32kb' }));
  router.use((req, res, next) => {
    if (!ready()) return res.sendStatus(503);
    if (req.body?.AccountSid !== config.accountSid || !validTwilioSignature({
      token: config.authToken, url: config.baseUrl + req.originalUrl, body: req.body,
      signature: req.get('X-Twilio-Signature'),
    })) return res.sendStatus(403);
    next();
  });
  routes.post('/entry', async (req, res) => {
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
  routes.post('/:id/:action', async (req, res) => serialized(req.params.id, async () => {
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
  async function waitForEntry(id, timeoutMs = 8000, { signal } = {}) {
    const until = Date.now() + timeoutMs;
    do {
      if (signal?.aborted) return false;
      const record = await store.getCall(id);
      if (signal?.aborted) return false;
      if (record?.parentSid && record.entryXml) return true;
      if (!record || revoked.has(id) || record.status === 'failed') return false;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < until);
    return false;
  }
  async function cancelPending(id, { signal } = {}) {
    return serialized(id, async () => {
      signal?.throwIfAborted();
      const record = await store.getCall(id);
      // Entry and cancellation share a lock: a late SIP leg cannot start a second dial.
      if (record?.parentSid) {
        if (record.entryXml) return false;
        throw new Error('relay_entry_uncertain');
      }
      revoked.add(id);
      if (record) await emit(record, 'failed', { status: 'failed' });
      return true;
    });
  }
  return { ready, preflight, start, failed, waitForEntry, cancelPending, router };
}

// REFER acceptance is not proof that Twilio reached the relay. Keep call control
// until the signed entry callback arrives, or invalidate the relay before fallback.
export function createTransferController({ relay, refer, hangup, store, log, timeoutMs = 8000, trackWork = (_kind, run) => run() }) {
  const calls = new Map();
  const stepTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, 8000) : 8000;
  async function bounded(work, { onTimeout } = {}) {
    let timer;
    const abort = new AbortController();
    try {
      return await Promise.race([trackWork('transfer_step', () => Promise.resolve().then(() => work(abort.signal))), new Promise((_, reject) => {
        timer = setTimeout(() => {
          onTimeout?.();
          abort.abort();
          reject(new Error('transfer_step_timeout'));
        }, stepTimeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  }
  async function run({ callId, tenant, target, prepare, beforeRefer, kind }, key, claimToken, intent) {
    let persistenceFailed = false;
    const greetingFallback = kind === 'greeting_fallback';
    const relayStatus = greetingFallback ? 'announcement_started' : 'screening_started';
    async function persistedRefer(targetUri, phase, signal) {
      try { await store.finishAttempt(key, { ...intent, claimToken, status: 'pending', phase, targetUri }); }
      catch { persistenceFailed = true; throw new Error('transfer_persistence_uncertain'); }
      signal?.throwIfAborted();
      await refer({ callId, targetUri });
      try { await store.finishAttempt(key, { ...intent, claimToken, status: 'pending', phase: phase + '_accepted' }); }
      catch { persistenceFailed = true; throw new Error('transfer_persistence_uncertain'); }
    }
    const fields = { call_id: callId, tenant_id: tenant.tenantId };
    const emit = (event, extra = {}) => log(`transfer.${event}`, { ...fields, ...extra });
    emit('requested');
    let transfer, lead = {}, leadSaved = false;
    let reason = 'preparation_failed', startTimedOut = false;
    const uncertain = (failureReason, ticket = transfer) => {
      emit('failed', { reason: failureReason });
      return { ok: false, transferred: false, lead_saved: leadSaved,
        status: 'transfer_uncertain', reason: failureReason,
        ...(ticket?.id ? { transferId: ticket.id } : {}) };
    };
    async function cleanupLateTicket(ticket) {
      try {
        if (!ticket?.id || await bounded(signal => relay.cancelPending(ticket.id, { signal })) !== true) {
          emit('failed', { reason: 'late_relay_cleanup_uncertain' });
          return;
        }
        emit('late_relay_revoked');
      } catch { emit('failed', { reason: 'late_relay_cleanup_uncertain' }); }
    }
    try {
      if (!greetingFallback && !/^\+[1-9]\d{7,14}$/.test(target || '')) throw new Error('invalid_target');
      const check = relay.preflight();
      emit('preflight', { ...check, fallback_ready: /^\+[1-9]\d{7,14}$/.test(target || '') });
      try {
        lead = await bounded(prepare);
        leadSaved = true;
      } catch (error) {
        if (!greetingFallback) throw error;
        // The announcement has a truthful unsaved-lead version as well.
        emit('lead_save_failed');
      }
      reason = check.reason;
      if (check.ready) {
        reason = 'relay_start_failed';
        transfer = await bounded(async signal => {
          try {
            const ticket = await relay.start({ callId, tenant, target, lead, leadSaved, kind, signal });
            if (startTimedOut) await cleanupLateTicket(ticket);
            return ticket;
          } catch (error) {
            if (startTimedOut && error?.transferTicket) await cleanupLateTicket(error.transferTicket);
            throw error;
          }
        }, { onTimeout: () => { startTimedOut = true; } });
        if (!transfer?.id || !transfer.targetUri) {
          if (transfer?.id) await cleanupLateTicket(transfer);
          return uncertain('relay_start_uncertain');
        }
        await bounded(signal => persistedRefer(transfer.targetUri, 'relay_refer_intent', signal));
        emit('relay_referred');
        if (await bounded(signal => relay.waitForEntry(transfer.id, Math.max(100, timeoutMs - 100), { signal })) === true) {
          return { ok: true, transferred: true, lead_saved: leadSaved, status: relayStatus, transferId: transfer.id };
        }
        reason = 'relay_entry_timeout';
      }
    } catch (error) {
      if (error?.transferTicket) transfer = error.transferTicket;
      emit('failed', { reason });
    }
    // A timed-out start may still allocate a ticket. Its late completion is
    // cleaned up above, but cannot authorize a second dial in the meantime.
    if (persistenceFailed) return uncertain('transfer_persistence_uncertain');
    if (startTimedOut) return uncertain('relay_start_timeout');
    if (transfer) {
      // Only an explicit revocation receipt permits fallback. A false receipt
      // means entry has completed; errors, timeouts and missing receipts do not.
      try {
        const cancelled = await bounded(signal => relay.cancelPending(transfer.id, { signal }));
        if (cancelled === false) {
          return { ok: true, transferred: true, lead_saved: leadSaved, status: relayStatus, transferId: transfer.id };
        }
        if (cancelled !== true) return uncertain('relay_cancellation_uncertain');
      } catch { return uncertain('relay_cancellation_uncertain'); }
    }
    // Only the claimed owner, with no possible live relay, may end a silent
    // greeting with no usable human destination. Replays cannot repeat this I/O.
    if (greetingFallback && !/^\+[1-9]\d{7,14}$/.test(target || '')) {
      if (!hangup) return uncertain('greeting_hangup_unavailable');
      try {
        await bounded(async signal => {
          await store.finishAttempt(key, { ...intent, claimToken, status: 'pending', phase: 'hangup_intent' });
          signal.throwIfAborted();
          await hangup({ callId });
        });
        return { ok: true, transferred: false, lead_saved: leadSaved, status: 'call_ended_no_audio' };
      } catch { return uncertain('greeting_hangup_uncertain'); }
    }
    // The companion owns its bounded SMS request and fixed ten-second window.
    // Do not apply the eight-second call-control timeout to that window.
    if (beforeRefer) {
      try { await beforeRefer({ lead }); }
      catch { emit('sms_failed', { reason: 'companion_failed' }); }
    }
    emit('fallback_refer', { reason });
    try {
      await bounded(signal => persistedRefer(`tel:${target}`, 'legacy_refer_intent', signal));
      emit('referred', { mode: 'legacy' });
      return { ok: true, transferred: true, lead_saved: leadSaved, status: 'legacy_referred' };
    } catch {
      emit('failed', { reason: 'legacy_refer_failed' });
      return { ok: false, transferred: false, lead_saved: leadSaved, status: 'transfer_uncertain', reason: 'legacy_refer_failed' };
    }
  }
  return options => {
    const { callId, tenant } = options;
    const kind = options.kind ?? 'transfer';
    const target = kind === 'greeting_fallback' && !options.target ? 'unavailable' : options.target;
    const unsupported = reason => ({ ok: false, transferred: false, lead_saved: false, status: 'transfer_uncertain', reason });
    if (!store?.claimAttempt || !store?.finishAttempt) return Promise.resolve(unsupported('durable_transfer_store_required'));
    if (typeof callId !== 'string' || !callId || typeof tenant?.tenantId !== 'string' || !tenant.tenantId || typeof target !== 'string' || !['transfer', 'greeting_fallback'].includes(kind) || (kind !== 'greeting_fallback' && !/^\+[1-9]\d{7,14}$/.test(target || ''))) {
      return Promise.resolve(unsupported('invalid_transfer_identity'));
    }
    // Bind the operation to the same snapshot as its durable claim, even if
    // caller-owned options are mutated while the store acknowledgment is pending.
    const snapshot = { ...options, callId, target, kind, tenant: { ...tenant } };
    const key = 'transfer:' + crypto.createHash('sha256').update(JSON.stringify([tenant.tenantId, callId])).digest('hex');
    const intent = { tenantId: tenant.tenantId, callId, target, kind, fingerprint: target };
    if (calls.has(key)) {
      const existing = calls.get(key);
      return existing.target === target && existing.kind === kind ? existing.work : Promise.resolve(unsupported('transfer_intent_conflict'));
    }
    const work = (async () => {
      try {
        // The durable claim is an at-most-once fence, not a lease. A crash may
        // sacrifice liveness; pending attempts are never automatically replayed.
        const claim = await bounded(() => store.claimAttempt(key, intent));
        if (!claim.claimed) return claim.record?.result || unsupported('transfer_attempt_pending');
        const claimToken = claim.record?.claimToken;
        if (!claimToken) return unsupported('transfer_claim_receipt_invalid');
        const result = await run(snapshot, key, claimToken, intent);
        await bounded(() => store.finishAttempt(key, { ...intent, claimToken, status: result.ok ? 'accepted' : 'uncertain', result }));
        return result;
      } catch (error) {
        return unsupported(/conflict/.test(error?.message || '') ? 'transfer_intent_conflict' : 'transfer_persistence_uncertain');
      }
    })();
    calls.set(key, { target, kind, work });
    work.finally(() => {
      const timer = setTimeout(() => { if (calls.get(key)?.work === work) calls.delete(key); }, 60000);
      timer.unref?.();
    }).catch(() => {});
    return work;
  };
}
