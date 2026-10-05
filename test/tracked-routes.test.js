import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { trackedHandler, trackedRoutes } from '../src/tracked-routes.js';
import { createCallLifecycle } from '../src/call-lifecycle.js';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function fixture() {
  const exits = [], logs = [];
  const lifecycle = createCallLifecycle({ log: (event, fields) => logs.push({ event, ...fields }), exit: code => exits.push(code), schedule: () => 1, cancel: () => {} });
  return { lifecycle, exits, logs, track: (kind, work) => lifecycle.track(kind, work) };
}
test('handler keeps this, arguments, next(error), return identity and synchronous throws', () => {
  const f = fixture(), owner = {}, req = {}, res = {}, error = Error('expected'); let passed;
  const handler = trackedHandler(function (a, b, next) { assert.equal(this, owner); assert.equal(a, req); assert.equal(b, res); next(error); return res; }, f.track);
  assert.equal(handler.call(owner, req, res, value => { passed = value; }), res); assert.equal(passed, error);
  assert.throws(() => trackedHandler(() => { throw error; }, f.track)(), value => value === error);
  const d = deferred(); assert.equal(trackedHandler(() => d.promise, f.track)(), d.promise); d.resolve();
});
test('four-argument error handler preserves Express arity and error object', () => {
  const f = fixture(), error = Error('expected'), response = {};
  const handler = trackedHandler(function (err, req, res, next) { assert.equal(err, error); next(); return res; }, f.track);
  assert.equal(handler.length, 4); assert.equal(handler(error, {}, response, () => {}), response);
});
test('early response and disconnected client do not settle an owned handler', async () => {
  const f = fixture(), d = deferred();
  const response = { end() {}, destroyed: true };
  trackedHandler(async (_req, res) => { res.end(); await d.promise; }, f.track)({}, response);
  f.lifecycle.shutdown(done => done()); assert.deepEqual(f.exits, []);
  d.resolve(); await flush(); assert.deepEqual(f.exits, [0]);
});
test('explicit nested router handlers stay tracked after HTTP response is sent', async t => {
  const f = fixture(), d = deferred(); const app = express(), child = express.Router();
  const routes = trackedRoutes(child, f.track);
  routes.get('/early', [(req, res, next) => next(), async (_req, res) => { res.end('accepted'); await d.promise; }]);
  app.use('/nested', child);
  const server = app.listen(0, '127.0.0.1'); t.after(() => { d.resolve(); server.close(); });
  await new Promise(resolve => server.once('listening', resolve));
  const text = await (await fetch(`http://127.0.0.1:${server.address().port}/nested/early`)).text();
  assert.equal(text, 'accepted'); assert.equal(f.lifecycle.snapshot().pending_work, 1);
  f.lifecycle.shutdown(done => server.close(done)); await flush(); assert.deepEqual(f.exits, []);
  d.resolve(); await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(f.exits, [0]);
});
test('registration adapter leaves target methods unchanged and preserves nested arrays', () => {
  const f = fixture(), calls = [], router = { post(...args) { calls.push(args); return this; } }, original = router.post;
  const routes = trackedRoutes(router, f.track); const handler = () => 7;
  assert.equal(routes.post('/path', [handler, [handler]]), router); assert.equal(router.post, original);
  assert.equal(calls[0][1][0](), 7); assert.equal(calls[0][1][1][0](), 7);
});
test('real client abort closes HTTP while its handler write remains tracked', async t => {
  const f = fixture(), entered = deferred(), write = deferred(); let writes = 0;
  const app = express(); const routes = trackedRoutes(app, f.track);
  routes.get('/disconnect', async (_req, res) => {
    entered.resolve(); await write.promise; writes++;
    if (!res.destroyed) res.end('done');
  });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => { write.resolve(); server.close(); });
  await new Promise(resolve => server.once('listening', resolve));
  const abort = new AbortController();
  const request = fetch(`http://127.0.0.1:${server.address().port}/disconnect`, { signal: abort.signal }).catch(() => {});
  await entered.promise; abort.abort(); await request;
  const closed = deferred();
  f.lifecycle.shutdown(done => server.close(error => { done(error); closed.resolve(); }));
  await closed.promise;
  assert.equal(writes, 0); assert.deepEqual(f.exits, []); assert.equal(f.lifecycle.snapshot().pending_work, 1);
  write.resolve(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes, 1); assert.deepEqual(f.exits, [0]);
});
