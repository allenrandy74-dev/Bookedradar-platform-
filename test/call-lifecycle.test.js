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
