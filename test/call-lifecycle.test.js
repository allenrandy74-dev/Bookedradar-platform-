import test from 'node:test';
import assert from 'node:assert/strict';
import { createCallLifecycle } from '../src/call-lifecycle.js';
function fixture() {
  const exits = [], logs = [];
  let deadline, closed;
  const lifecycle = createCallLifecycle({ log: (event, fields) => logs.push({ event, ...fields }), exit: c => exits.push(c), schedule: fn => { deadline = fn; return 1; }, cancel: () => {} });
  return { lifecycle, exits, logs, shutdown: () => lifecycle.shutdown(fn => { closed = fn; }), close: () => closed(), timeout: () => deadline() };
}
test('HTTP closure does not terminate an active voice call', () => {
  const f = fixture();
  f.lifecycle.begin('call'); f.shutdown(); f.close();
  assert.deepEqual(f.exits, []);
  assert.equal(f.lifecycle.begin('new'), false);
  f.lifecycle.end('call');
  assert.deepEqual(f.exits, [0]);
});
test('drain waits for every call and pending HTTP request', () => {
  const f = fixture();
  f.lifecycle.begin('a'); f.lifecycle.begin('b');
  assert.equal(f.lifecycle.begin('a'), false);
  f.shutdown(); f.lifecycle.end('a'); f.lifecycle.end('b');
  assert.deepEqual(f.exits, []);
  f.close(); assert.deepEqual(f.exits, [0]);
});
test('drain timeout is bounded and repeated shutdown is harmless', () => {
  const f = fixture(); f.lifecycle.begin('call'); f.shutdown(); f.shutdown(); f.close(); f.timeout();
  f.lifecycle.end('call'); assert.deepEqual(f.exits, [1]);
  assert.equal(f.logs.find(x => x.event === 'server.drain_timeout').active_calls, 1);
});
test('idle server exits as soon as HTTP is closed', () => {
  const f = fixture(); f.shutdown(); f.close(); assert.deepEqual(f.exits, [0]);
});

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
test('call count zero waits for finalization, dispatch and OPS work', async () => {
  const f = fixture(); const pending = ['call_finalization', 'automatic_dispatch', 'ops_alert_check'].map(kind => {
    const d = deferred(); f.lifecycle.track(kind, () => d.promise); return d;
  });
  f.lifecycle.begin('a'); f.shutdown(); f.close(); f.lifecycle.end('a');
  assert.equal(f.lifecycle.count(), 0); assert.equal(f.lifecycle.snapshot().pending_work, 3);
  for (const d of pending.slice(0, 2)) d.resolve(); await flush(); assert.deepEqual(f.exits, []);
  pending[2].resolve(); await flush(); assert.deepEqual(f.exits, [0]);
});
test('late nested receipt write remains owned after call ends', async () => {
  const f = fixture(), provider = deferred(), receipt = deferred();
  f.lifecycle.track('sideband_message', async () => {
    await provider.promise;
    await f.lifecycle.track('transfer_receipt', () => receipt.promise);
  });
  f.lifecycle.begin('a'); f.shutdown(); f.close(); f.lifecycle.end('a');
  provider.resolve(); await flush(); assert.equal(f.lifecycle.snapshot().pending_work, 2);
  assert.deepEqual(f.exits, []); receipt.resolve(); await flush(); assert.deepEqual(f.exits, [0]);
});
test('failed owned work is sanitized and cannot report successful drain', async () => {
  const f = fixture(), d = deferred(); f.lifecycle.track('call_finalization', () => d.promise);
  f.shutdown(); f.close(); d.reject(new Error('secret database password')); await flush();
  assert.deepEqual(f.exits, [1]); assert.equal(f.logs.at(-1).event, 'server.drain_failed');
  assert.equal(f.logs.at(-1).complete, false); assert.ok(!JSON.stringify(f.logs).includes('secret'));
});
test('hung resource cleanup stays bounded by original referenced deadline', async () => {
  const exits = [], logs = [], cleanup = deferred(); let deadline, time, cancels = 0, cleanups = 0;
  const lifecycle = createCallLifecycle({ log: (event, fields) => logs.push({ event, ...fields }),
    exit: code => exits.push(code), finalize: () => { cleanups++; return cleanup.promise; },
    schedule: (fn, ms) => { deadline = fn; time = ms; return 1; }, cancel: () => cancels++ });
  lifecycle.shutdown(done => done()); await flush();
  assert.equal(time, 25000); assert.equal(cleanups, 1); assert.equal(cancels, 0);
  lifecycle.shutdown(() => assert.fail('repeated close')); deadline();
  assert.deepEqual(exits, [1]); assert.equal(logs.at(-1).event, 'server.drain_timeout');
  assert.equal(logs.at(-1).cleanup_started, true); cleanup.resolve(); await flush();
  assert.deepEqual(exits, [1]); assert.equal(cancels, 1);
});
test('successful pool cleanup precedes successful drain log and exit', async () => {
  const events = [], cleanup = deferred();
  const lifecycle = createCallLifecycle({ log: event => events.push(event), exit: code => events.push(code),
    finalize: () => { events.push('cleanup'); return cleanup.promise; }, schedule: () => 1, cancel: () => {} });
  lifecycle.shutdown(done => done()); await flush(); assert.deepEqual(events, ['server.draining', 'cleanup']);
  cleanup.resolve(); await flush(); assert.deepEqual(events.slice(-2), ['server.drain_complete', 0]);
});
test('producer stop failure and HTTP close failure fail closed without a false success', () => {
  const f = fixture();
  f.lifecycle.shutdown(() => { throw new Error('close'); }, () => { throw new Error('stop'); });
  assert.equal(f.lifecycle.snapshot().failed_work, 2); assert.equal(f.lifecycle.snapshot().http_closed, false);
  f.timeout(); assert.deepEqual(f.exits, [1]);
});
test('force exit reports owned pending work and never retries or cancels provider work', async () => {
  const f = fixture(), d = deferred(); let attempts = 0;
  f.lifecycle.track('transfer_step', () => { attempts++; return d.promise; });
  f.shutdown(); f.close(); f.timeout(); f.timeout();
  assert.deepEqual(f.exits, [1]); assert.equal(f.logs.at(-1).pending_work, 1);
  assert.equal(f.logs.at(-1).external_call_legs, 'not_tracked'); assert.equal(attempts, 1);
  d.resolve(); await flush(); assert.equal(attempts, 1); assert.deepEqual(f.exits, [1]);
});
test('two instances need separate completion evidence', async () => {
  const a = fixture(), b = fixture(), write = deferred();
  b.lifecycle.track('call_finalization', () => write.promise);
  a.shutdown(); b.shutdown(); a.close(); b.close();
  assert.deepEqual(a.exits, [0]); assert.deepEqual(b.exits, []);
  assert.equal(a.lifecycle.snapshot().pending_work, 0); assert.equal(b.lifecycle.snapshot().pending_work, 1);
  write.resolve(); await flush(); assert.deepEqual(b.exits, [0]);
});
test('invalid labels and instance values never reach structured logs', () => {
  const logs = []; const lifecycle = createCallLifecycle({ log: (event, fields) => logs.push({ event, ...fields }),
    identity: { instance_id: 'safe-1', deploy_id: 'secret\nunsafe', boot_id: 'boot-1' }, exit: () => {}, schedule: () => 1, cancel: () => {} });
  assert.throws(() => lifecycle.track('secret\nunsafe', () => { throw Error('secret'); }));
  lifecycle.shutdown(done => done());
  assert.ok(!JSON.stringify(logs).includes('secret')); assert.equal(logs.at(-1).instance_id, 'safe-1');
});
test('historical handled failure is distinct from incomplete or still-running work', async () => {
  const f = fixture();
  await f.lifecycle.track('http_handler', async () => { throw Error('handled'); }).catch(() => {});
  await flush(); f.shutdown(); f.close();
  assert.deepEqual(f.exits, [1]); const result = f.logs.at(-1);
  assert.equal(result.event, 'server.drain_failed'); assert.equal(result.failure_scope, 'process_lifetime');
  assert.equal(result.owned_work_settled, true); assert.equal(result.pending_work, 0); assert.equal(result.cleanup_complete, true);
});
test('late work during cleanup waits until settled and cannot be certified as successful', async () => {
  const logs = [], exits = [], cleanup = deferred(), late = deferred();
  const lifecycle = createCallLifecycle({ log: (event, fields) => logs.push({ event, ...fields }), exit: code => exits.push(code),
    finalize: () => cleanup.promise, schedule: () => 1, cancel() {} });
  lifecycle.shutdown(done => done()); await flush();
  lifecycle.track('late_write', () => late.promise); cleanup.resolve(); await flush();
  assert.deepEqual(exits, []); late.resolve(); await flush();
  assert.deepEqual(exits, [1]); assert.equal(logs.at(-1).event, 'server.drain_failed');
  assert.equal(logs.at(-1).owned_work_settled, true); assert.equal(logs.at(-1).cleanup_complete, true);
});
