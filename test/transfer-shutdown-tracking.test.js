import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransferController } from '../src/warm-transfer.js';
import { createTransferCompanion } from '../src/transfer-companion.js';
import { createCallLifecycle } from '../src/call-lifecycle.js';
import { attemptStore } from './helpers/transfer-attempt-store.js';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
function fixture() {
  const exits = [], logs = []; let deadline;
  const lifecycle = createCallLifecycle({ log: (event, fields) => logs.push({ event, ...fields }), exit: code => exits.push(code), schedule: fn => { deadline = fn; return 1; }, cancel() {} });
  return { lifecycle, exits, logs, deadline: () => deadline(), trackWork: (kind, run) => lifecycle.track(kind, run) };
}
test('controller timeout does not hide its late durable claim or launch a provider attempt', async () => {
  const f = fixture(), claim = deferred(); let providers = 0;
  const store = { ...attemptStore(), claimAttempt: () => claim.promise };
  const run = createTransferController({ store, trackWork: f.trackWork, timeoutMs: 5,
    relay: { preflight: () => ({ ready: false }) }, refer: async () => { providers++; }, hangup: async () => { providers++; }, log() {} });
  const result = await run({ callId: 'synthetic', tenant: { tenantId: 'test' }, target: '+15555550101', prepare: async () => ({}) });
  assert.equal(result.status, 'transfer_uncertain');
  assert.equal(f.lifecycle.snapshot().pending_work, 1);
  f.lifecycle.shutdown(done => done()); assert.deepEqual(f.exits, []);
  claim.resolve({ claimed: true, record: { claimToken: 'late' } }); await flush();
  assert.equal(providers, 0); assert.deepEqual(f.exits, [0]);
});
test('late underlying SMS request stays visible after its uncertainty receipt and companion delay finish', async () => {
  const f = fixture(), provider = deferred(); let requests = 0, id = 0; const timers = new Map();
  const companion = createTransferCompanion({ trackWork: f.trackWork, store: attemptStore(),
    config: { accountSid: 'AC' + 'a'.repeat(32), authToken: 'synthetic', fromNumber: '+15555550100' },
    fetchImpl: () => { requests++; return provider.promise; }, log() {}, smsTimeoutMs: 5,
    schedule: (fn, ms) => { timers.set(++id, { fn, ms }); return id; }, cancel: key => timers.delete(key), now: () => 0 });
  const args = { callId: 'synthetic', tenant: { tenantId: 'test' }, target: '+15555550101' };
  const pending = companion.notifyAndWait(args); await flush();
  const timeout = [...timers.values()].find(timer => timer.ms === 5); assert.ok(timeout); timeout.fn(); await flush();
  const delay = [...timers.values()].find(timer => timer.ms === 10000); assert.ok(delay); delay.fn();
  const result = await pending; assert.equal(result.status, 'uncertain');
  f.lifecycle.shutdown(done => done()); assert.deepEqual(f.exits, []);
  assert.equal(f.lifecycle.snapshot().work_by_kind.transfer_sms_provider, 1);
  const replay = await companion.notifyAndWait(args); assert.equal(replay.duplicate, true); assert.equal(requests, 1);
  provider.resolve({ ok: true, json: async () => ({ sid: 'SM' + 'b'.repeat(32), status: 'queued' }) }); await flush();
  assert.equal(requests, 1); assert.deepEqual(f.exits, [0]);
});
test('hung SMS provider forces incomplete exit once without provider retry', async () => {
  const f = fixture(); let requests = 0;
  f.lifecycle.track('transfer_sms_provider', () => { requests++; return new Promise(() => {}); });
  f.lifecycle.shutdown(done => done()); f.deadline(); f.deadline();
  assert.deepEqual(f.exits, [1]); assert.equal(requests, 1); assert.equal(f.logs.at(-1).work_by_kind.transfer_sms_provider, 1);
});
