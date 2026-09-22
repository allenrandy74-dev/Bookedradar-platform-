import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import express from 'express';
import { createGreetingWatchdog } from '../src/greeting-watchdog.js';
import { createWarmTransfer, whisperText } from '../src/warm-transfer.js';

test('transfer request preserves captured intake and only fills missing name or service', async () => {
  // Exercise the production prepare callback without starting the HTTP/SIP server.
  const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
  const handler = source.slice(source.indexOf('if (name === "transfer_to_human")'));
  const match = handler.match(/prepare: async \(\) => \{([\s\S]*?)\n    \} \}\);/);
  assert.ok(match, 'transfer prepare callback exists');
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const prepare = new AsyncFunction('state', 'args', 'executeTool', 'callId', 'callerNumber', 'tenant', match[1]);
  const context = { name: 'Replacement', service_type: 'I want to speak with someone', urgency: 'routine', preferred_window: 'anytime' };
  for (const lastLead of [
    { name: 'Jane', service_type: 'Burst pipe', urgency: 'emergency', preferred_window: 'today after 3', address: '123 Example St' },
    { urgency: 'urgent', preferred_window: 'tomorrow morning' },
    {},
  ]) {
    const before = structuredClone(lastLead);
    const captured = [];
    const result = await prepare({ getCall: async () => ({ lastLead }) }, { context }, async tool => captured.push(tool), 'test-call', '', {});
    assert.equal(result.urgency, before.urgency);
    assert.equal(result.preferred_window, before.preferred_window);
    assert.equal(result.name, before.name || context.name);
    assert.equal(result.service_type, before.service_type || context.service_type);
    assert.equal(result.address, before.address);
    assert.deepEqual(lastLead, before);
    assert.equal(captured.length, 1);
    assert.equal(captured[0].name, 'capture_lead');
    assert.equal(captured[0].syncCrm, false);
    assert.deepEqual(captured[0].args, result);
  }
});

function clock() {
  const timers = new Map(); let i = 0, time = 0;
  return { schedule(fn) { timers.set(++i, fn); return i; }, cancel(id) { timers.delete(id); }, now: () => time,
    async tick() { time += 4000; const pending = [...timers.values()]; timers.clear(); for (const f of pending) await f(); }, timers };
}
test('greeting waits for actual SIP playback, retries once, cancels active generation', async () => {
  const c = clock(), sent = [], logs = []; let fallbacks = 0;
  const w = createGreetingWatchdog({ ...c, businessName: 'Acme', send: e => sent.push(e), log: e => logs.push(e), fallback: () => { fallbacks++; } });
  w.open(); w.event({ type: 'response.created', response: { id: 'r1' } });
  w.event({ type: 'response.output_audio_transcript.done', transcript: 'hello' });
  await c.tick();
  assert.deepEqual(sent.map(x => x.type), ['response.create','response.cancel','response.create']);
  assert.equal(sent[0].response.tool_choice, 'none');
  assert.match(sent[0].response.instructions, /Thank you for calling Acme/);
  await c.tick(); await c.tick();
  assert.equal(fallbacks, 1);
  assert.deepEqual(logs, ['greeting.requested','greeting.retry','greeting.failed','greeting.fallback']);
});
test('audio-start suppresses retry and fallback; repeat open is idempotent', async () => {
  const c = clock(), logs = [], sent = [];
  const w = createGreetingWatchdog({ ...c, businessName: 'Acme', send: e => sent.push(e), log: e => logs.push(e), fallback: () => assert.fail() });
  w.open(); w.open(); w.event({ type: 'output_audio_buffer.started' }); await c.tick();
  assert.equal(sent.length, 1); assert.deepEqual(logs, ['greeting.requested','greeting.first_audio']);
});
test('stalled sideband handshake is bounded and falls back once', async () => {
  const c = clock(); let count = 0;
  createGreetingWatchdog({ ...c, businessName: 'Acme', send() {}, log() {}, fallback() { count++; } });
  await c.tick(); await c.tick(); await c.tick(); assert.equal(count, 1);
});
test('stopping watchdog on transfer prevents subsequent fallback', async () => {
  const c = clock(); const w = createGreetingWatchdog({ ...c, send() {}, log() {}, fallback: () => assert.fail() });
  w.open(); w.stop(); await c.tick(); assert.equal(c.timers.size, 0);
});

async function fixture(t) {
  const records = new Map(), logs = [];
  const store = { async getCall(id) { return records.get(id); }, async patchCall(id, patch) { records.set(id, { ...records.get(id), ...patch }); } };
  const config = { enabled: true, domain: 'bookedradar-handoff.sip.twilio.com', baseUrl: 'https://example.com', accountSid: 'AC'+'a'.repeat(32), authToken: 'test-secret', callerId: '+15555550100' };
  const tenant = { tenantId: 'demo', businessName: 'Acme & Sons' };
  const registry = { resolve: ({ tenantId }) => tenantId === 'demo' ? tenant : null };
  const relay = createWarmTransfer({ store, registry, config, log: (event, fields) => logs.push({event, ...fields}) });
  const app = express(); app.use('/voice/transfer', relay.router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(() => new Promise(r => server.close(r)));
  const parent = 'CA'+'b'.repeat(32), child = 'CA'+'c'.repeat(32);
  async function post(url, body, signed = true) {
    const path = new URL(url, config.baseUrl).pathname + new URL(url, config.baseUrl).search;
    body = { AccountSid: config.accountSid, ...body };
    let payload = config.baseUrl + path;
    for (const k of Object.keys(body).sort()) payload += k + body[k];
    const signature = crypto.createHmac('sha1', config.authToken).update(payload).digest('base64');
    const result = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded','X-Twilio-Signature': signed ? signature : 'bad'}, body: new URLSearchParams(body)});
    return { status: result.status, text: await result.text() };
  }
  const transfer = await relay.start({ callId: 'openai-call', tenant, target:'+15555550101', lead: {name:'Jane <script>', service_type:'AC stopped', urgency:'urgent', preferred_window:'today'}, leadSaved:true });
  const entry = () => post('/voice/transfer/entry', {To: transfer.targetUri,CallSid:parent});
  const callback = action => {
    const record = records.get(transfer.id), p = `/voice/transfer/${record.id}/${action}`;
    return p+'?sig='+crypto.createHmac('sha256',record.secret).update(p).digest('hex');
  };
  const emptyPost = () => fetch(`http://127.0.0.1:${server.address().port}/voice/transfer/entry`, { method: 'POST' });
  return { relay, records, config, tenant, logs, parent, child, post, entry, callback, transfer, emptyPost };
}
test('bodyless webhook requests are rejected without a server error', async t => {
  const f = await fixture(t);
  assert.equal((await f.emptyPost()).status, 403);
});
test('screened transfer plays private context, requires 1, and confirms bridge only from Twilio', async t => {
  const f = await fixture(t); assert.equal(f.relay.ready(), true);
  const entry = await f.entry(); assert.equal(entry.status, 200);
  assert.match(entry.text, /answerOnBridge="true"/); assert.match(entry.text, /ringTone="us"/);
  assert.match(entry.text, /Please hold/); assert.doesNotMatch(entry.text,/Jane/);
  const leg = {CallSid:f.child, ParentCallSid:f.parent};
  const screen = await f.post(f.callback('screen'), leg);
  assert.match(screen.text,/This is a BookedRadar transfer for Acme &amp; Sons/);
  assert.match(screen.text,/Jane &lt;script&gt;/); assert.match(screen.text,/AC stopped/); assert.match(screen.text,/urgent/); assert.match(screen.text,/today/);
  assert.match(screen.text,/actionOnEmptyResult="true"/);
  await f.post(f.callback('status'), {...leg, CallStatus:'ringing'});
  await f.post(f.callback('accept'), {...leg,Digits:'1'});
  assert.equal(f.logs.some(x=>x.event==='transfer.bridged'),false);
  await f.post(f.callback('complete'),{CallSid:f.parent,DialCallSid:f.child,DialCallStatus:'completed',DialBridged:'true'});
  assert.equal(f.logs.filter(x=>x.event==='transfer.bridged').length,1);
  assert.doesNotMatch(JSON.stringify(f.logs),/Jane|555555|AC stopped|test-secret/);
});
for (const digit of ['', '2']) test(`screening ${digit ? 'rejection' : 'timeout'} hangs up recipient and preserves caller fallback`, async t => {
  const f = await fixture(t); await f.entry();
  const leg={CallSid:f.child,ParentCallSid:f.parent};
  await f.post(f.callback('screen'),leg);
  const reject=await f.post(f.callback('accept'),{...leg,Digits:digit}); assert.match(reject.text,/<Hangup\/>/);
  const result=await f.post(f.callback('complete'),{CallSid:f.parent,DialCallSid:f.child,DialCallStatus:'completed',DialBridged:'false'});
  assert.match(result.text,/saved for follow-up/); assert.equal(f.logs.some(x=>x.event==='transfer.rejected'),true);
  assert.equal(f.logs.some(x=>x.event==='transfer.fallback'),true); assert.equal(f.logs.some(x=>x.event==='transfer.bridged'),false);
});
test('no answer fallback does not claim a successful handoff',async t=>{
  const f=await fixture(t); await f.entry();
  const result=await f.post(f.callback('complete'),{CallSid:f.parent,DialCallSid:f.child,DialCallStatus:'no-answer',DialBridged:'false'});
  assert.match(result.text,/unavailable/); assert.equal(f.logs.some(x=>x.event==='transfer.no_answer'),true);
});
test('unsigned, forged action, wrong account, and cross-call callbacks cannot screen or dial',async t=>{
  const f=await fixture(t);
  assert.equal((await f.post('/voice/transfer/entry',{To:f.transfer.targetUri,CallSid:f.parent},false)).status,403);
  assert.equal((await f.post('/voice/transfer/entry',{To:f.transfer.targetUri,CallSid:f.parent,AccountSid:'AC'+'d'.repeat(32)})).status,403);
  await f.entry();
  assert.equal((await f.post(f.callback('screen'),{CallSid:f.child,ParentCallSid:'CA'+'e'.repeat(32)})).status,403);
  assert.equal((await f.post(f.callback('screen').replace('screen','accept'),{CallSid:f.child,ParentCallSid:f.parent,Digits:'1'})).status,403);
  assert.equal((await f.post('/voice/transfer/entry',{To:f.transfer.targetUri,CallSid:f.child})).status,403);
});
test('relay entry retries are idempotent and disabled configuration refuses traffic',async t=>{
  const f=await fixture(t); const a=await f.entry(),b=await f.entry(); assert.equal(a.text,b.text);
  assert.equal(f.logs.filter(x=>x.event==='transfer.dialing').length,1);
  f.config.enabled=false; assert.equal(f.relay.ready(),false); assert.equal((await f.entry()).status,503);
});
test('missing caller details are honestly identified',()=>{assert.match(whisperText({businessName:'Acme'}),/Caller: Not collected/);});
test('failed lead persistence never produces a saved-lead claim in the audible fallback',async t=>{
  const f=await fixture(t);
  const transfer=await f.relay.start({callId:'silent',tenant:f.tenant,kind:'greeting_fallback',leadSaved:false});
  const result=await f.post('/voice/transfer/entry',{To:transfer.targetUri,CallSid:f.parent});
  assert.match(result.text,/Please call the business again/); assert.doesNotMatch(result.text,/saved/);
});

test('call acceptance preserves model, voice, tools and explicitly enables short-turn VAD', async () => {
  const { acceptRealtimeCall } = await import('../src/openai-call.js');
  const saved = globalThis.fetch; let body;
  globalThis.fetch = async (_url, options) => { body = JSON.parse(options.body); return new Response(''); };
  try { await acceptRealtimeCall({apiKey:'test',callId:'test',model:'existing-model',voice:'marin',instructions:'existing intake',tools:[]}); }
  finally { globalThis.fetch = saved; }
  assert.equal(body.model,'existing-model'); assert.equal(body.audio.output.voice,'marin');
  assert.equal(body.instructions,'existing intake');
  assert.equal(body.audio.input.turn_detection.create_response,true);
  assert.equal(body.audio.input.turn_detection.interrupt_response,true);
  assert.equal(body.audio.input.turn_detection.threshold,0.35);
});

// The production handler uses this same controller; no provider calls are made here.
import { createTransferController } from '../src/warm-transfer.js';
function controllerFixture(overrides = {}) {
  const events = [], targets = [];
  const relay = {
    preflight: () => ({ ready: true, reason: 'configured' }),
    start: async () => ({ id: 'transfer', targetUri: 'sip:opaque@example.com' }),
    waitForEntry: async () => true,
    cancelPending: async () => true,
    ...overrides,
  };
  const run = createTransferController({ relay, timeoutMs: 30,
    refer: async ({targetUri}) => targets.push(targetUri),
    log: (event, fields) => events.push({event,...fields}),
  });
  const options = {callId:'call', tenant:{tenantId:'demo'},target:'+15555550100',prepare:async()=>({})};
  return {run, options, events, targets, relay};
}
test('configuration failure invokes proven REFER exactly once', async () => {
  const f = controllerFixture({preflight:()=>({ready:false,reason:'relay_configuration_invalid'}),start:()=>assert.fail('must not start screening')});
  const [a,b] = await Promise.all([f.run(f.options),f.run(f.options)]);
  assert.equal(a.status,'legacy_referred'); assert.equal(b.status,a.status);
  assert.deepEqual(f.targets,['tel:+15555550100']);
  assert.deepEqual(f.events.map(e=>e.event),['transfer.requested','transfer.preflight','transfer.fallback_refer','transfer.referred']);
  assert.equal(JSON.stringify(f.events).includes('+1555'),false);
});
test('relay accepted by API but never entered triggers fallback',async()=>{
  const f=controllerFixture({waitForEntry:async()=>false});
  assert.equal((await f.run(f.options)).status,'legacy_referred');
  assert.deepEqual(f.targets,['sip:opaque@example.com','tel:+15555550100']);
  assert.equal(f.events.find(e=>e.event==='transfer.fallback_refer').reason,'relay_entry_timeout');
});
test('preflight exception, preparation timeout, start failure and callback timeout cannot hang transfer',async()=>{
  for (const kind of ['preflight','prepare','start','waitForEntry']) {
    const overrides=kind==='prepare'?{}:{[kind]:kind==='waitForEntry'?()=>new Promise(()=>{}):()=>{throw new Error('secret must not be logged');}};
    const f=controllerFixture(overrides);
    if(kind==='prepare') f.options.prepare=()=>new Promise(()=>{});
    assert.equal((await f.run(f.options)).status,'legacy_referred',kind);
    assert.equal(f.targets.at(-1),'tel:+15555550100');
    assert.equal(JSON.stringify(f.events).includes('secret'),false);
  }
});
test('entry arriving at cancellation boundary prevents a duplicate human dial',async()=>{
  const f=controllerFixture({waitForEntry:async()=>false,cancelPending:async()=>false});
  assert.equal((await f.run(f.options)).status,'screening_started');
  assert.deepEqual(f.targets,['sip:opaque@example.com']);
});
test('revoked pending relay rejects late Twilio entry',async t=>{
  const f=await fixture(t);
  assert.equal(await f.relay.cancelPending(f.transfer.id),true);
  assert.equal((await f.entry()).status,403);
  assert.equal(f.logs.some(e=>e.event==='transfer.dialing'),false);
});
test('confirmed relay entry disarms cancellation and emits dialing',async t=>{
  const f=await fixture(t); await f.entry();
  assert.equal(await f.relay.waitForEntry(f.transfer.id,20),true);
  assert.equal(await f.relay.cancelPending(f.transfer.id),false);
});
test('legacy provider failure returns control to the assistant with explicit failure',async()=>{
  const events=[];
  const run=createTransferController({relay:{preflight:()=>({ready:false,reason:'screening_disabled'})},refer:async()=>{throw new Error('provider failure');},log:event=>events.push(event)});
  const result=await run({callId:'failed',tenant:{tenantId:'demo'},target:'+15555550100',prepare:async()=>({})});
  assert.equal(result.transferred,false); assert.equal(result.reason,'legacy_refer_failed');
  assert.equal(events.at(-1),'transfer.failed');
});
