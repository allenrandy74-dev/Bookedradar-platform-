import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { createCallLifecycle } from '../src/call-lifecycle.js';
import { trackedRoutes } from '../src/tracked-routes.js';
const source = await fs.readFile(new URL('../server.js', import.meta.url), 'utf8');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function fixture() {
  const exits = [], logs = [];
  const callLifecycle = createCallLifecycle({ log: (event, fields) => logs.push({ event, ...fields }), exit: code => exits.push(code), schedule: () => 1, cancel: () => {} });
  return { exits, logs, callLifecycle, trackWork: (kind, operation) => callLifecycle.track(kind, operation) };
}
function evaluate(text, values) { return Function(...Object.keys(values), text)(...Object.values(values)); }
test('actual webhook owns admission across an asynchronous receipt write and SIGTERM', async () => {
  const f = fixture(), receipt = deferred(), accepted = deferred(); let handler, providerCalls = 0, response;
  const router = { post: (_path, fn) => { handler = fn; } };
  const event = { type: 'realtime.call.incoming', id: 'event', data: { call_id: 'call' } };
  const start = source.indexOf('routes.post("/openai/webhook"');
  const end = source.indexOf('\nif (E2E_SMOKE_TEST_ON_STARTUP', start);
  assert.ok(start > 0 && end > start);
  evaluate(source.slice(start, end), { ...f, routes: trackedRoutes(router, f.trackWork), voiceEnabled: true,
    openai: { webhooks: { unwrap: async () => event } }, OPENAI_WEBHOOK_SECRET: 'synthetic',
    state: { markWebhookOnce: () => receipt.promise },
    handleIncomingCall: async () => { providerCalls++; await accepted.promise; },
    recordCallMilestone() {}, callHistory: { finish: async () => {} }, console: { error() {} } });
  const res = { status(code) { response = { code }; return this; }, send(body) { response.body = body; return this; } };
  const pending = handler({ header: () => 'event' }, res); await flush();
  assert.equal(f.callLifecycle.count(), 1); f.callLifecycle.shutdown(done => done());
  assert.deepEqual(f.exits, []); assert.equal(response, undefined);
  receipt.resolve(true); await pending; await flush();
  assert.equal(response.code, 200); assert.equal(providerCalls, 1); assert.deepEqual(f.exits, []);
  f.callLifecycle.end('call'); await flush(); assert.deepEqual(f.exits, []);
  accepted.resolve(); await flush(); assert.deepEqual(f.exits, [0]);
});
test('actual close handler awaits late message write before reading final lead and finishing history', async () => {
  const f = fixture(), write = deferred(), finish = deferred(), ws = new EventEmitter(); let leadSaved = false, finalLead;
  const message = f.trackWork('sideband_message', async () => { await write.promise; leadSaved = true; });
  const pendingSidebandWork = new Set([message]);
  const start = source.indexOf('  ws.on("close", () => {'); const end = source.indexOf('\n}\n\nasync function handleIncomingCall', start);
  assert.ok(start > 0 && end > start);
  const stoppable = { stop() {}, close() {} };
  evaluate(source.slice(start, end), { ...f, ws, callId: 'call', pendingSidebandWork,
    state: { getCall: async () => { assert.equal(leadSaved, true); return { lastLead: { name: 'Synthetic' } }; } },
    callHistory: { finish: async (_id, value) => { finalLead = value; await finish.promise; } }, maskPhone: value => value,
    postSaveResponse: stoppable, conversationOutputGuard: stoppable, openingAudio: stoppable,
    greetingTurns: stoppable, greeting: stoppable, transferHold: stoppable, console: { error() {} } });
  f.callLifecycle.begin('call'); f.callLifecycle.shutdown(done => done()); ws.emit('close');
  assert.equal(f.callLifecycle.count(), 0); assert.deepEqual(f.exits, []); assert.equal(finalLead, undefined);
  write.resolve(); await flush(); assert.equal(finalLead.leadSummary.name, 'Synthetic'); assert.deepEqual(f.exits, []);
  finish.resolve(); await flush(); assert.deepEqual(f.exits, [0]);
});
test('actual shutdown stops every periodic producer once and tracks dispatch already in progress', async () => {
  const f = fixture(), write = deferred(); let dispatches = 0; const stopped = [], logged = [];
  const start = source.indexOf('let dispatchTimer = null;');
  const end = source.indexOf('\nif (dispatchIntervalSeconds > 0', start);
  const shutdownStart = source.indexOf('function shutdown(signal)');
  const shutdownEnd = source.indexOf('\nprocess.on("SIGTERM"', shutdownStart);
  const api = evaluate(source.slice(start, end) + '\ndispatchTimer = 3;\n' + source.slice(shutdownStart, shutdownEnd) + '\nreturn { runAutomaticDispatch, shutdown };', {
    ...f, DISPATCH_INTERVAL_SECONDS: '30', DISPATCH_ENABLED: 'true', registry: { list: () => [{}, {}] },
    dispatchGate: () => ({ armed: true }), dispatcherFor: () => ({ dispatcher: { runOnce: async () => { dispatches++; await write.promise; } } }),
    opsInitialTimer: 1, opsIntervalTimer: 2, clearInterval: value => stopped.push(value), clearTimeout: value => stopped.push(value),
    server: { close: done => done() }, console: { log: text => logged.push(text), error() {} } });
  const running = api.runAutomaticDispatch(); await flush();
  api.shutdown('SIGTERM'); api.shutdown('SIGINT'); assert.deepEqual(stopped, [3, 1, 2]);
  await api.runAutomaticDispatch(); assert.equal(dispatches, 1); assert.deepEqual(f.exits, []);
  write.resolve(); await running; await flush(); assert.equal(dispatches, 1); assert.deepEqual(f.exits, [0]);
});
test('all current application route registration points explicitly use tracking', () => {
  assert.doesNotMatch(source, /^app\.(get|post|put|patch|delete)\(/m);
  assert.match(source, /mountReconciliationRoutes\(routes,/);
  assert.match(source, /trackWork\("ops_alert_check", performOpsAlertCheck\)/);
  assert.match(source, /trackSidebandWork\("greeting_fallback"/);
  assert.match(source, /trackWork\("call_milestone"/);
});
test('actual OPS runner waits in-flight incident writes and starts no new checks while draining', async () => {
  const f = fixture(), summary = deferred(), write = deferred(); let summaries = 0, writes = 0;
  const start = source.indexOf('let opsAlertCheckRunning = false;');
  const end = source.indexOf('\nif (OPS_ALERTS_ENABLED.toLowerCase()', start);
  const run = evaluate(source.slice(start, end) + '\nreturn runOpsAlertCheck;', { ...f,
    OPS_ALERTS_ENABLED: 'true', OPS_ALERT_WINDOW_MINUTES: '10', OPS_ALERT_COOLDOWN_MINUTES: '30',
    opsIncidentStore: { resolveScope: async () => { writes++; await write.promise; } },
    registry: { list: () => [{ tenantId: 'one' }, { tenantId: 'two' }] },
    callHistory: { operationalSummary: async () => { summaries++; return summary.promise; } },
    assessVoiceHealth: () => ({ status: 'healthy' }), buildOpsAlertCandidate: () => null,
    console: { log() {}, error() {} } });
  const pending = run(); await flush(); f.callLifecycle.shutdown(done => done());
  await run(); assert.equal(summaries, 1); assert.deepEqual(f.exits, []);
  summary.resolve({}); await flush(); assert.equal(writes, 1); assert.deepEqual(f.exits, []);
  write.resolve(); await pending; await flush(); assert.equal(summaries, 1); assert.deepEqual(f.exits, [0]);
});
