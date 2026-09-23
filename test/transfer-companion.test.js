import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransferCompanion, createTransferHold, transferSummary, TRANSFER_HOLD_MESSAGE } from '../src/transfer-companion.js';
import { createTransferController } from '../src/warm-transfer.js';

const config = { accountSid: 'AC' + 'a'.repeat(32), authToken: 'private-token', fromNumber: '+15555550100' };
const tenant = { tenantId: 'test', businessName: 'Test Plumbing' };
const accepted = () => ({ ok: true, json: async () => ({ sid: 'SM' + 'b'.repeat(32), status: 'queued' }) });
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function clock() {
  let time = 0, id = 0;
  const timers = new Map();
  return { now: () => time,
    schedule(fn, ms) { timers.set(++id, { at: time + ms, fn }); return id; },
    cancel(id) { timers.delete(id); },
    async advance(ms) {
      const end = time + ms;
      for (;;) {
        const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        time = next[1].at; timers.delete(next[0]); next[1].fn(); await flush();
      }
      time = end; await flush();
    }, timers,
  };
}

test('summary uses captured fields, omits missing values and does not include arbitrary notes', () => {
  const text = transferSummary(tenant, { name: 'Jane', service_type: 'Burst pipe', urgency: 'urgent', preferred_window: 'today after 3', service_address: '123 Example St', city: 'Example City', callback_number: '+15555550102', notes: 'private unstructured note' }, '+15555550999');
  for (const value of ['Test Plumbing', 'Jane', 'Burst pipe', 'urgent', 'today after 3', '123 Example St', 'Example City', '+15555550102']) assert.ok(text.includes(value));
  assert.doesNotMatch(text, /private unstructured note|5555550999/);
  assert.equal(transferSummary(tenant, {}), 'BookedRadar transfer — Test Plumbing');
  assert.match(transferSummary(tenant, {}, '+15555550999'), /Callback: \+15555550999/);
});

for (const mode of ['accepted', 'rejected', 'network_error', 'timeout', 'not_configured', 'invalid_response']) {
  test(`SMS ${mode}: one REFER only after the full twenty-second window`, async () => {
    const c = clock(), logs = [], calls = [], requests = [];
    let acceptRequest;
    const companion = createTransferCompanion({ config: mode === 'not_configured' ? {} : config, ...c,
      log: (event, fields) => logs.push({ event, ...fields }),
      fetchImpl: async (url, options) => {
        requests.push({ url, options });
        if (mode === 'timeout') return new Promise(() => {});
        if (mode === 'network_error') throw new Error('secret +15555550102');
        if (mode === 'rejected') return { ok: false };
        if (mode === 'invalid_response') return { ok: true, json: async () => ({ status: 'failed' }) };
        return new Promise(resolve => { acceptRequest = () => resolve(accepted()); });
      },
    });
    const transfer = createTransferController({ relay: { preflight: () => ({ ready: false, reason: 'screening_disabled' }) },
      refer: async args => calls.push({ ...args, at: c.now() }), log: (event, fields) => logs.push({ event, ...fields }) });
    const options = { callId: 'call', tenant, target: '+15555550101', prepare: async () => ({ name: 'Jane', urgency: 'urgent' }), beforeRefer: ({ lead }) => companion.notifyAndWait({ callId: 'call', tenant, target: '+15555550101', lead }) };
    const result = transfer(options);
    assert.equal(transfer(options), result, 'duplicate tool execution shares the notification and timer');
    await flush();
    if (mode === 'accepted') {
      await c.advance(2000);
      assert.equal(calls.length, 0);
      assert.equal(logs.some(x => x.event === 'transfer.delay_started'), false, 'do not start the timer before provider acceptance');
      acceptRequest(); await flush();
    }
    if (mode === 'timeout') {
      await c.advance(8000);
      assert.equal(requests[0].options.signal.aborted, true);
    }
    const start = c.now();
    assert.equal(logs.filter(x => x.event === 'transfer.delay_started').length, 1);
    await c.advance(19999);
    assert.equal(calls.length, 0, 'REFER must not begin early');
    await c.advance(1);
    assert.equal((await result).transferred, true);
    assert.deepEqual(calls, [{ callId: 'call', targetUri: 'tel:+15555550101', at: start + 20000 }]);
    assert.equal(logs.filter(x => x.event === 'transfer.delay_complete').length, 1);
    assert.equal(logs.filter(x => x.event === `transfer.sms_${mode === 'accepted' ? 'sent' : 'failed'}`).length, 1);
    assert.doesNotMatch(JSON.stringify(logs), /Jane|urgent|555555|private-token|Burst pipe/);
    if (requests.length) {
      assert.equal(requests.length, 1);
      assert.equal(requests[0].options.body.get('To'), options.target);
      assert.match(requests[0].options.body.get('Body'), /Test Plumbing/);
    }
  });
}

test('hold speaks once, stays quiet during the wait, and restores VAD on failed transfer', async () => {
  const c = clock(), sent = [], logs = [];
  const hold = createTransferHold({ ...c, send: event => sent.push(event), log: event => logs.push(event) });
  const vad = { type: 'server_vad', threshold: 0.35, create_response: true, interrupt_response: true, idle_timeout_ms: 10000 };
  hold.event({ type: 'session.created', session: { audio: { input: { turn_detection: vad } } } });
  hold.start(); hold.start();
  let responses = sent.filter(x => x.type === 'response.create');
  assert.equal(responses.length, 1);
  assert.ok(responses[0].response.instructions.includes(TRANSFER_HOLD_MESSAGE));
  assert.equal(responses[0].response.tool_choice, 'none');
  assert.deepEqual(sent[0].session.audio.input.turn_detection, { ...vad, create_response: false, interrupt_response: false });
  hold.event({ type: 'response.created', response: { id: 'hold-1', metadata: { purpose: 'bookedradar_transfer_hold', sequence: '1' } } });
  hold.event({ type: 'output_audio_buffer.started', response_id: 'hold-1' });
  await c.advance(3500);
  assert.equal(sent.filter(x => x.type === 'response.create').length, 1);
  hold.event({ type: 'response.done', response: { id: 'hold-1' } });
  assert.equal(sent.filter(x => x.type === 'response.create').length, 1, 'generation completion is not playback completion');
  hold.event({ type: 'output_audio_buffer.stopped', response_id: 'hold-1' });
  await c.advance(20000);
  assert.equal(sent.filter(x => x.type === 'response.create').length, 1, 'completed announcement must not loop');
  hold.stop({ restore: true });
  assert.deepEqual(sent.at(-1).session.audio.input.turn_detection, vad);
  assert.ok(sent.some(x => x.type === 'output_audio_buffer.clear'));
  await c.advance(10000);
  assert.equal(sent.filter(x => x.type === 'response.create').length, 1);
});

for (const signals of ['none', 'generated_only', 'unmatched_playback', 'cleared']) {
  test(`hold never replays with ${signals} events throughout SMS timeout and transfer wait`, async () => {
    const c = clock(), sent = [], logs = [];
    const hold = createTransferHold({ ...c, send: event => sent.push(event), log: event => logs.push(event) });
    hold.start();
    if (signals !== 'none') {
      hold.event({ type: 'response.created', response: { id: 'hold-1', metadata: { purpose: 'bookedradar_transfer_hold', sequence: '1' } } });
      hold.event({ type: 'response.done', response: { id: 'hold-1', status: 'completed' } });
    }
    if (signals === 'unmatched_playback') {
      hold.event({ type: 'output_audio_buffer.started', response_id: 'other' });
      hold.event({ type: 'output_audio_buffer.stopped' });
    }
    if (signals === 'cleared') {
      hold.event({ type: 'output_audio_buffer.started', response_id: 'hold-1' });
      hold.event({ type: 'output_audio_buffer.cleared', response_id: 'hold-1' });
    }
    for (let i = 0; i < 10; i++) {
      await c.advance(3000);
      hold.start(); // Duplicate transfer requests cannot restart the announcement.
      assert.equal(sent.filter(x => x.type === 'response.create').length, 1);
    }
    assert.equal(logs.includes('transfer.hold_retry'), false);
    hold.stop(); await c.advance(30000);
    assert.equal(sent.filter(x => x.type === 'response.create').length, 1);
  });
}

test('a late hold response after stop is cancelled without replay', () => {
  const sent = [];
  const hold = createTransferHold({ send: event => sent.push(event), log() {} });
  hold.start(); hold.stop();
  hold.event({ type: 'response.created', response: { id: 'late', metadata: { purpose: 'bookedradar_transfer_hold', sequence: '1' } } });
  assert.deepEqual(sent.at(-1), { type: 'response.cancel', response_id: 'late' });
  assert.equal(sent.filter(x => x.type === 'response.create').length, 1);
});

test('sideband send failure does not throw and cannot prevent transfer execution', () => {
  const c = clock(), logs = [];
  const hold = createTransferHold({ ...c, send() { throw new Error('socket closed'); }, log: event => logs.push(event) });
  assert.doesNotThrow(() => hold.start());
  assert.ok(logs.includes('transfer.hold_failed'));
  hold.stop();
});
