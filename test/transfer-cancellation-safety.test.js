import { attemptStore } from './helpers/transfer-attempt-store.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransferController, createWarmTransfer } from '../src/warm-transfer.js';

const tenant = { tenantId: 'synthetic', businessName: 'Synthetic' };
const options = { callId: 'synthetic-call', tenant, target: '+15555550101', prepare: async () => ({}) };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function fixture(overrides = {}) {
  const refs = [], events = [];
  const relay = { preflight: () => ({ ready: true, reason: 'configured' }),
    start: async () => ({ id: 'ticket', targetUri: 'sip:synthetic@synthetic.invalid' }),
    waitForEntry: async () => false, cancelPending: async () => true, ...overrides };
  const run = createTransferController({ store: attemptStore(), relay, timeoutMs: 15,
    refer: async value => refs.push(value), log: (event, fields) => events.push({ event, ...fields }) });
  return { run, refs, events };
}
for (const [kind, cancelPending] of [
  ['throw', async () => { throw Error('private-error'); }],
  ['stall', () => new Promise(() => {})],
  ['missing receipt', async () => undefined],
  ['truthy receipt', async () => ({ cancelled: true })],
]) test(`cancellation ${kind} fails closed without a second REFER or companion notification`, async () => {
  const f = fixture({ cancelPending }); let notifications = 0;
  const work = f.run({ ...options, beforeRefer: async () => { notifications++; } });
  const result = await Promise.race([work, sleep(150).then(() => 'hung')]);
  assert.notEqual(result, 'hung');
  assert.equal(result.ok, false); assert.equal(result.transferred, false);
  assert.equal(result.reason, 'relay_cancellation_uncertain');
  assert.equal(notifications, 0); assert.equal(f.refs.length, 1);
  assert.equal(await f.run(options), result);
  assert.equal(f.events.some(x => x.event === 'transfer.referred'), false);
  assert.doesNotMatch(JSON.stringify(f.events), /private-error/);
});

test('late cancellation completion does not change the terminal uncertain result or start fallback', async () => {
  let finish;
  const f = fixture({ cancelPending: () => new Promise(resolve => { finish = resolve; }) });
  const result = await f.run(options); finish(true); await sleep(0);
  assert.equal(await f.run(options), result); assert.equal(f.refs.length, 1);
});

test('unresolved start never launches fallback; a late noncooperative ticket is revoked exactly once', async () => {
  let finish, revoked = 0;
  const f = fixture({ start: () => new Promise(resolve => { finish = resolve; }),
    cancelPending: async id => { assert.equal(id, 'late'); revoked++; return true; } });
  const result = await f.run(options);
  assert.equal(result.reason, 'relay_start_timeout'); assert.equal(result.ok, false);
  assert.equal(f.refs.length, 0);
  finish({ id: 'late', targetUri: 'sip:late@synthetic.invalid' }); await sleep(0);
  assert.equal(revoked, 1); assert.equal(f.refs.length, 0);
  assert.equal(f.events.filter(x => x.event === 'transfer.late_relay_revoked').length, 1);
  assert.equal(await f.run(options), result);
});

for (const kind of ['stall', 'reject', 'already entered']) test(`late-ticket cleanup ${kind} is bounded and cannot claim success`, async () => {
  let finish, cleanupSignal, cleanupEntered;
  const cleanupStarted = new Promise(resolve => { cleanupEntered = resolve; });
  const f = fixture({ start: () => new Promise(resolve => { finish = resolve; }),
    cancelPending: async (_id, { signal }) => {
      cleanupSignal = signal;
      cleanupEntered();
      if (kind === 'stall') return new Promise(() => {});
      if (kind === 'reject') throw Error('private-error');
      return false;
    } });
  const result = await f.run(options);
  finish({ id: 'late', targetUri: 'sip:late@synthetic.invalid' });
  // The cleanup deadline starts in a continuation after start resolves. Wait
  // for that phase before starting the observation window; CPU contention can
  // otherwise expire this test's timer before cleanup has even begun.
  await cleanupStarted;
  await sleep(40);
  assert.equal(result.ok, false); assert.equal(f.refs.length, 0);
  assert.equal(f.events.filter(x => x.reason === 'late_relay_cleanup_uncertain').length, 1);
  assert.equal(f.events.some(x => x.event === 'transfer.late_relay_revoked'), false);
  if (kind === 'stall') assert.equal(cleanupSignal.aborted, true);
});

function warmFixture(patchHook = async () => {}) {
  const records = new Map();
  const store = { getCall: async id => records.get(id), patchCall: async (id, patch) => {
    await patchHook(id, patch); records.set(id, { ...records.get(id), ...patch });
  } };
  const relay = createWarmTransfer({ store, registry: { resolve: () => tenant }, log() {},
    config: { enabled: true, domain: 'synthetic.sip.twilio.com', baseUrl: 'https://synthetic.invalid',
      accountSid: 'AC' + 'a'.repeat(32), authToken: 'synthetic-secret', callerId: '+15555550100' } });
  return { relay, records };
}

test('aborted start refuses allocation; in-flight allocation is eventually durably revoked', async () => {
  const aborted = new AbortController(); aborted.abort();
  const f = warmFixture();
  await assert.rejects(f.relay.start({ ...options, signal: aborted.signal }));
  assert.equal(f.records.size, 0);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const slow = warmFixture(async (_id, patch) => { if (patch.status === 'requested') await gate; });
  const refs = [];
  const run = createTransferController({ store: attemptStore(), relay: slow.relay, refer: async x => refs.push(x), log() {}, timeoutMs: 15 });
  assert.equal((await run(options)).reason, 'relay_start_timeout');
  release(); await sleep(20);
  assert.equal(slow.records.size, 1);
  assert.equal([...slow.records.values()][0].status, 'failed');
  assert.equal(refs.length, 0);
});

test('partially persisted entry cannot masquerade as screening success at cancellation', async () => {
  const f = warmFixture();
  const ticket = await f.relay.start(options);
  f.records.get(ticket.id).parentSid = 'CA' + 'b'.repeat(32);
  await assert.rejects(f.relay.cancelPending(ticket.id), /relay_entry_uncertain/);
});

test('entry polling stops after cancellation even if a store read resolves late', async () => {
  let finish, reads = 0;
  const relay = createWarmTransfer({ store: { getCall: () => { reads++; return new Promise(r => { finish = r; }); } }, config: {}, log() {} });
  const abort = new AbortController();
  const work = relay.waitForEntry('ticket', 1000, { signal: abort.signal });
  abort.abort(); finish({ status: 'requested' });
  assert.equal(await work, false); await sleep(120); assert.equal(reads, 1);
});

test('rejected native start acknowledgment still revokes its written ticket before fallback', async () => {
  const records = new Map(), refs = [];
  const relay = createWarmTransfer({
    store: { getCall: async id => records.get(id), patchCall: async (id, patch) => {
      records.set(id, { ...records.get(id), ...patch });
      if (patch.status === 'requested') throw Error('lost-ack');
    } }, registry: { resolve: () => tenant }, log() {},
    config: { enabled: true, domain: 'synthetic.sip.twilio.com', baseUrl: 'https://synthetic.invalid',
      accountSid: 'AC' + 'a'.repeat(32), authToken: 'synthetic-secret', callerId: '+15555550100' },
  });
  const run = createTransferController({ store: attemptStore(), relay, refer: async x => {
    assert.equal([...records.values()][0].status, 'failed'); refs.push(x);
  }, log() {}, timeoutMs: 15 });
  assert.equal((await run(options)).status, 'legacy_referred');
  assert.equal(refs.length, 1); assert.match(refs[0].targetUri, /^tel:/);
});

test('late rejected native start acknowledgment also cleans up the allocated ticket', async () => {
  const records = new Map(), events = []; let release;
  const gate = new Promise(resolve => { release = resolve; });
  const relay = createWarmTransfer({
    store: { getCall: async id => records.get(id), patchCall: async (id, patch) => {
      if (patch.status === 'requested') await gate;
      records.set(id, { ...records.get(id), ...patch });
      if (patch.status === 'requested') throw Error('lost-ack');
    } }, registry: { resolve: () => tenant }, log() {},
    config: { enabled: true, domain: 'synthetic.sip.twilio.com', baseUrl: 'https://synthetic.invalid',
      accountSid: 'AC' + 'a'.repeat(32), authToken: 'synthetic-secret', callerId: '+15555550100' },
  });
  const run = createTransferController({ store: attemptStore(), relay, refer: async () => assert.fail('uncertain start must not REFER'),
    log: event => events.push(event), timeoutMs: 15 });
  assert.equal((await run(options)).reason, 'relay_start_timeout');
  release(); await sleep(20);
  assert.equal([...records.values()][0].status, 'failed');
  assert.equal(events.includes('transfer.late_relay_revoked'), true);
});
