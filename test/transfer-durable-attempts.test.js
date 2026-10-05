import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStateStore } from '../src/state-store.js';
import { createTransferController } from '../src/warm-transfer.js';
import { createTransferCompanion } from '../src/transfer-companion.js';
const input = { callId:'call', tenant:{tenantId:'synthetic',businessName:'Synthetic'}, target:'+15555550101', prepare:async()=>({}) };
const config = { accountSid:'AC'+'a'.repeat(32),authToken:'synthetic-only',fromNumber:'+15555550100' };
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const deadlineMs = 100;
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const deferred = () => {
 let resolve;
 const promise = new Promise(done => { resolve = done; });
 return { promise, resolve };
};
// Control only transfer deadlines. Real fsync/lock retries and the test watchdog
// must keep progressing even when parallel CI load delays disk acknowledgments.
function controlledDeadlines(t) {
 const pending = new Set();
 t.mock.method(globalThis, 'setTimeout', (callback, ms, ...args) => {
   if (ms !== deadlineMs) return realSetTimeout(callback, ms, ...args);
   const timer = { fire: () => callback(...args) };
   pending.add(timer);
   return timer;
 });
 t.mock.method(globalThis, 'clearTimeout', timer => {
   if (!pending.delete(timer)) realClearTimeout(timer);
 });
 t.after(() => assert.equal(pending.size, 0, 'transfer deadline leaked across test completion'));
 return () => {
   assert.equal(pending.size, 1, 'expire exactly the transfer step at the observed barrier');
   const timer = pending.values().next().value;
   pending.delete(timer);
   timer.fire();
 };
}
const nextTurn = () => new Promise(resolve => setImmediate(resolve));
async function fixture(t) {
 const dir=await mkdtemp(path.join(os.tmpdir(),'transfer-durable-')); t.after(()=>rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'state.json');
 const build=async()=>{const store=new JsonStateStore(file);await store.load();return store;};
 return {build,store:await build(),expireDeadline:controlledDeadlines(t)};
}
const controller = (store, refer, extra={}) => createTransferController({store,refer,log(){},timeoutMs:deadlineMs,relay:{preflight:()=>({ready:false,reason:'disabled'})},...extra});
const companion = (store, fetchImpl) => createTransferCompanion({store,config,fetchImpl,log(){},smsTimeoutMs:deadlineMs,schedule:(fn,ms)=>setTimeout(fn,ms===10000?0:ms)});
const accepted=async()=>({ok:true,json:async()=>({sid:'SM'+'b'.repeat(32),status:'queued'})});

test('controller completed result survives disk reconstruction; tenant isolation and target conflict',async t=>{
 const f=await fixture(t);let refs=0;
 const first=await controller(f.store,async()=>refs++)(input);
 assert.equal(first.status,'legacy_referred');
 assert.deepEqual(await controller(await f.build(),async()=>refs++)(input),first);
 assert.equal((await controller(await f.build(),async()=>refs++)({...input,target:'+15555550102'})).reason,'transfer_intent_conflict');
 await controller(await f.build(),async()=>refs++)({...input,tenant:{tenantId:'other'}});
 assert.equal(refs,2);
});
test('parallel controller instances claim before provider call',async t=>{
 const f=await fixture(t);let refs=0;
 await Promise.all([controller(f.store,async()=>{refs++;await sleep(5);})(input),controller(await f.build(),async()=>refs++)(input)]);
 assert.equal(refs,1);
});
test('crash boundary after claim before provider remains fenced after reconstruction',async t=>{
 const f=await fixture(t);let refs=0, entered;
 const preparing=new Promise(resolve=>{entered=resolve;});
 const blocked=controller(f.store,async()=>refs++)({...input,prepare:()=>{entered();return new Promise(()=>{});}});
 await completesWithin(preparing);
 const replay=await controller(await f.build(),async()=>refs++)(input);
 assert.equal(replay.reason,'transfer_attempt_pending');
 f.expireDeadline();await completesWithin(blocked);assert.equal(refs,1);
});
test('provider acceptance followed by receipt write failure never replays',async t=>{
 const f=await fixture(t);let refs=0;
 const broken={claimAttempt:f.store.claimAttempt.bind(f.store),finishAttempt:async(key,patch)=>{
   if(patch.phase?.endsWith('_accepted') || patch.result) throw Error('synthetic crash');
   return f.store.finishAttempt(key,patch);
 }};
 await controller(broken,async()=>refs++)(input);
 await controller(await f.build(),async()=>refs++)(input);
 assert.equal(refs,1);
});
test('failed claim and delayed pre-provider persistence cannot dispatch',async t=>{
 const f=await fixture(t);let refs=0;
 await controller({claimAttempt:async()=>{throw Error('disk');},finishAttempt(){}},async()=>refs++)(input);
 let release, finished;const completed=new Promise(resolve=>{finished=resolve;});
 const entered=deferred();
 const slow={claimAttempt:f.store.claimAttempt.bind(f.store),finishAttempt:async(key,patch)=>{
   if(patch.phase==='legacy_refer_intent') {
     await new Promise(resolve=>{release=resolve;entered.resolve();});
     try { return await f.store.finishAttempt(key,patch); } finally { finished(); }
   }
   return f.store.finishAttempt(key,patch);
 }};
 const work=controller(slow,async()=>refs++)(input);
 await completesWithin(entered.promise);f.expireDeadline();
 await completesWithin(work);release();await completesWithin(completed);assert.equal(refs,0);
});
test('missing durable adapter fails closed for controller and SMS',async()=>{
 let effects=0;assert.equal((await controller(undefined,async()=>effects++)(input)).reason,'durable_transfer_store_required');
 assert.equal((await companion(undefined,async()=>effects++).notifyAndWait(input)).status,'unsupported');assert.equal(effects,0);
});
test('SMS acceptance survives disk reconstruction and same-call content/target conflicts',async t=>{
 const f=await fixture(t);let sends=0;const fetch=async()=>{sends++;return accepted();};
 assert.equal((await companion(f.store,fetch).notifyAndWait(input)).status,'accepted');
 assert.equal((await companion(await f.build(),fetch).notifyAndWait(input)).duplicate,true);
 await companion(await f.build(),fetch).notifyAndWait({...input,lead:{name:'changed'}});
 await companion(await f.build(),fetch).notifyAndWait({...input,target:'+15555550102'});
 assert.equal(sends,1);
 await companion(await f.build(),fetch).notifyAndWait({...input,tenant:{tenantId:'other'}});assert.equal(sends,2);
});
test('SMS ambiguous timeout and receipt failure never resend after restart',async t=>{
 const f=await fixture(t);let sends=0;
 const entered=deferred();
 const work=companion(f.store,async()=>{sends++;entered.resolve();return new Promise(()=>{});}).notifyAndWait(input);
 await completesWithin(entered.promise);f.expireDeadline();await completesWithin(work);
 await companion(await f.build(),async()=>{sends++;return accepted();}).notifyAndWait(input);assert.equal(sends,1);
 const next={...input,callId:'receipt-crash'};
 await companion({claimAttempt:f.store.claimAttempt.bind(f.store),finishAttempt:async()=>{throw Error('disk');}},async()=>{sends++;return accepted();}).notifyAndWait(next);
 await companion(await f.build(),async()=>{sends++;return accepted();}).notifyAndWait(next);assert.equal(sends,2);
});
test('controller ambiguous REFER timeout persists uncertainty and never resends',async t=>{
 const f=await fixture(t);let refs=0;
 const entered=deferred();
 const work=controller(f.store,async()=>{refs++;entered.resolve();return new Promise(()=>{});})(input);
 await completesWithin(entered.promise);f.expireDeadline();
 const first=await completesWithin(work);
 assert.equal(first.ok,false);
 assert.deepEqual(await controller(await f.build(),async()=>refs++)(input),first);
 assert.equal(refs,1);
});
test('parallel companion instances share one persisted SMS intent',async t=>{
 const f=await fixture(t);let sends=0;
 const fetch=async()=>{sends++;await sleep(2);return accepted();};
 await Promise.all([companion(f.store,fetch).notifyAndWait(input),companion(await f.build(),fetch).notifyAndWait(input)]);
 assert.equal(sends,1);
});

// This real-time limit detects a broken test/barrier; safety deadlines above are controlled.
const completesWithin = async (work, ms=10000) => {
 let timer;
 try { return await Promise.race([work,new Promise((_,reject)=>{timer=realSetTimeout(()=>reject(Error('test_observed_unbounded_store_wait')),ms);})]); }
 finally { realClearTimeout(timer); }
};
for (const kind of ['controller','SMS']) test(`${kind} never-settling durable claim returns bounded uncertainty without provider I/O`,async t=>{
 const f=await fixture(t);let effects=0;const entered=deferred();
 const blocked={claimAttempt:async(key,intent)=>{await f.store.claimAttempt(key,intent);entered.resolve();return new Promise(()=>{});},finishAttempt:f.store.finishAttempt.bind(f.store)};
 const start=store=>kind==='controller' ? controller(store,async()=>effects++)(input) : companion(store,async()=>{effects++;return accepted();}).notifyAndWait(input);
 const work=start(blocked);
 await completesWithin(entered.promise);f.expireDeadline();
 const result=await completesWithin(work);
 assert.equal(result.status,kind==='controller'?'transfer_uncertain':'uncertain');
 await completesWithin(start(await f.build()));assert.equal(effects,0);
});
for (const kind of ['controller','SMS']) test(`${kind} late claim acknowledgment cannot resume abandoned provider work`,async t=>{
 const f=await fixture(t);let effects=0, release;const entered=deferred();
 const delayed={claimAttempt:async(key,intent)=>{const claim=await f.store.claimAttempt(key,intent);return new Promise(resolve=>{release=()=>resolve(claim);entered.resolve();});},finishAttempt:f.store.finishAttempt.bind(f.store)};
 const start=store=>kind==='controller' ? controller(store,async()=>effects++)(input) : companion(store,async()=>{effects++;return accepted();}).notifyAndWait(input);
 const work=start(delayed);
 await completesWithin(entered.promise);f.expireDeadline();await completesWithin(work);
 release();await nextTurn();await completesWithin(start(await f.build()));assert.equal(effects,0);
});
for (const kind of ['controller','SMS']) test(`${kind} never-settling terminal receipt returns bounded uncertainty and never replays`,async t=>{
 const f=await fixture(t);let effects=0;const entered=deferred();
 const blocked={claimAttempt:f.store.claimAttempt.bind(f.store),finishAttempt:async(key,patch)=>{
   if(kind==='SMS'||patch.result){entered.resolve();return new Promise(()=>{});}
   return f.store.finishAttempt(key,patch);
 }};
 const start=store=>kind==='controller' ? controller(store,async()=>effects++)(input) : companion(store,async()=>{effects++;return accepted();}).notifyAndWait(input);
 const work=start(blocked);
 await completesWithin(entered.promise);f.expireDeadline();
 const result=await completesWithin(work);
 assert.equal(result.status,kind==='controller'?'transfer_uncertain':'uncertain');
 await completesWithin(start(await f.build()));assert.equal(effects,1);
});
for (const kind of ['controller','SMS']) test(`${kind} late terminal receipt may reconcile outcome but cannot resume provider work`,async t=>{
 const f=await fixture(t);let effects=0, release, finished;const entered=deferred();
 const completed=new Promise(resolve=>{finished=resolve;});
 const delayed={claimAttempt:f.store.claimAttempt.bind(f.store),finishAttempt:async(key,patch)=>{
   const terminal=kind==='SMS'||patch.result;
   if(terminal)await new Promise(resolve=>{release=resolve;entered.resolve();});
   const receipt=await f.store.finishAttempt(key,patch);
   if(terminal)finished();
   return receipt;
 }};
 const start=store=>kind==='controller' ? controller(store,async()=>effects++)(input) : companion(store,async()=>{effects++;return accepted();}).notifyAndWait(input);
 const work=start(delayed);
 await completesWithin(entered.promise);f.expireDeadline();
 const result=await completesWithin(work);
 assert.equal(result.status,kind==='controller'?'transfer_uncertain':'uncertain');
 await completesWithin(start(await f.build()));
 release();await completesWithin(completed);
 const replay=await completesWithin(start(await f.build()));
 assert.equal(kind==='controller'?replay.ok:replay.status,kind==='controller'?true:'accepted');
 assert.equal(effects,1);
});
test('companion request and receipt retain pre-claim tenant, content, account, sender and credentials snapshot',async t=>{
 const f=await fixture(t);let release, entered, observedIntent, observedRequest;
 const waiting=new Promise(resolve=>{entered=resolve;});
 const delayed={claimAttempt:async(key,intent)=>{
   observedIntent=structuredClone(intent);const claim=await f.store.claimAttempt(key,intent);
   entered();return new Promise(resolve=>{release=()=>resolve(claim);});
 },finishAttempt:f.store.finishAttempt.bind(f.store)};
 const mutableConfig={...config};
 const mutable={...input,tenant:{...input.tenant},lead:{name:'Original person',callback_number:'+15555550103'}};
 const sender=createTransferCompanion({store:delayed,config:mutableConfig,log(){},smsTimeoutMs:deadlineMs,
   schedule:(fn,ms)=>setTimeout(fn,ms===10000?0:ms),fetchImpl:async(url,options)=>{observedRequest={url,options};return accepted();}});
 const work=sender.notifyAndWait(mutable);await waiting;
 mutable.tenant.tenantId='changed-tenant';mutable.tenant.businessName='Changed Business';
 mutable.lead.name='Changed person';mutable.lead.callback_number='+15555550104';mutable.target='+15555550105';
 mutableConfig.accountSid='AC'+'c'.repeat(32);mutableConfig.fromNumber='+15555550106';mutableConfig.authToken='changed-token';
 release();assert.equal((await work).status,'accepted');
 const body=observedRequest.options.body;
 assert.equal(body.get('To'),input.target);assert.equal(body.get('From'),config.fromNumber);
 assert.match(body.get('Body'),/Original person/);assert.match(body.get('Body'),/15555550103/);assert.doesNotMatch(body.get('Body'),/Changed|50104/);
 assert.equal(observedRequest.url,`https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`);
 assert.equal(observedRequest.options.headers.Authorization,`Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64')}`);
 assert.equal(observedIntent.tenantId,input.tenant.tenantId);
 const crypto=await import('node:crypto');
 assert.equal(observedIntent.fingerprint,crypto.createHash('sha256').update(JSON.stringify([config.accountSid,config.fromNumber,body.get('Body')])).digest('hex'));
});
test('controller options mutation during durable claim cannot redirect the bound REFER',async t=>{
 const f=await fixture(t);let release, entered, observedIntent;const refs=[];
 const waiting=new Promise(resolve=>{entered=resolve;});
 const delayed={claimAttempt:async(key,intent)=>{observedIntent=structuredClone(intent);const claim=await f.store.claimAttempt(key,intent);entered();return new Promise(resolve=>{release=()=>resolve(claim);});},finishAttempt:f.store.finishAttempt.bind(f.store)};
 const mutable={...input,tenant:{...input.tenant}};
 const run=controller(delayed,async value=>refs.push(value),{timeoutMs:deadlineMs});
 const work=run(mutable);await waiting;
 mutable.callId='changed-call';mutable.target='+15555550107';mutable.tenant.tenantId='changed-tenant';mutable.prepare=async()=>assert.fail('mutated callback ran');
 release();assert.equal((await work).status,'legacy_referred');
 assert.deepEqual(refs,[{callId:input.callId,targetUri:`tel:${input.target}`}]);
 assert.equal(observedIntent.callId,input.callId);assert.equal(observedIntent.tenantId,input.tenant.tenantId);assert.equal(observedIntent.target,input.target);
});

test('transfer deadline mocks are restored after each fixture',()=>{
 assert.equal(globalThis.setTimeout,realSetTimeout);
 assert.equal(globalThis.clearTimeout,realClearTimeout);
});

const greetingInput = { ...input, kind:'greeting_fallback' };
const announcementRelay = extra => ({
 preflight:()=>({ready:true,reason:'configured'}),
 start:async()=>({id:'announcement',targetUri:'sip:announcement@synthetic.invalid'}),
 waitForEntry:async()=>true,
 cancelPending:async()=>true,
 ...extra,
});
for (const firstKind of ['transfer','greeting_fallback']) test(`${firstKind} claim excludes competing watchdog/normal intent across independent instances and reconstruction`,async t=>{
 const f=await fixture(t);let refs=0;const entered=deferred(), release=deferred();
 const first={...input,kind:firstKind,prepare:async()=>{entered.resolve();return release.promise;}};
 const work=controller(f.store,async()=>refs++)(first);await completesWithin(entered.promise);
 const second={...input,kind:firstKind==='transfer'?'greeting_fallback':'transfer'};
 assert.equal((await controller(await f.build(),async()=>refs++)(second)).reason,'transfer_intent_conflict');
 release.resolve({});assert.equal((await work).status,'legacy_referred');
 assert.equal((await controller(await f.build(),async()=>refs++)(second)).reason,'transfer_intent_conflict');
 assert.equal(refs,1);
});
test('same-process watchdog and normal kind conflict before preparation or provider I/O',async t=>{
 const f=await fixture(t);let refs=0;const entered=deferred(),release=deferred();
 const run=controller(f.store,async()=>refs++);
 const work=run({...greetingInput,prepare:async()=>{entered.resolve();return release.promise;}});
 await completesWithin(entered.promise);assert.equal((await run(input)).reason,'transfer_intent_conflict');
 release.resolve({});await work;assert.equal(refs,1);
});
test('watchdog announcement works without human target and survives replay with truthful failed capture',async t=>{
 const f=await fixture(t);let refs=0, starts=0, ends=0;
 const relay=announcementRelay({start:async args=>{
   starts++;assert.equal(args.kind,'greeting_fallback');assert.equal(args.leadSaved,false);
   return {id:'announcement',targetUri:'sip:announcement@synthetic.invalid'};
 }});
 const run=store=>controller(store,async arg=>{refs++;assert.match(arg.targetUri,/^sip:/);},{relay,hangup:async()=>ends++});
 const options={...greetingInput,target:'',prepare:async()=>{throw Error('synthetic capture failure');}};
 const result=await run(f.store)(options);assert.equal(result.status,'announcement_started');assert.equal(result.lead_saved,false);
 assert.deepEqual(await run(await f.build())(options),result);
 await run(await f.build())({...options,tenant:{tenantId:'other'}});
 assert.equal(starts,2);assert.equal(refs,2);assert.equal(ends,0);
});
test('watchdog known relay rejection revokes before human fallback without losing safe fallback',async t=>{
 const f=await fixture(t);const effects=[];
 const relay=announcementRelay({waitForEntry:async()=>false,cancelPending:async()=>{effects.push('revoke');return true;}});
 const result=await controller(f.store,async arg=>effects.push(arg.targetUri),{relay})(greetingInput);
 assert.equal(result.status,'legacy_referred');
 assert.deepEqual(effects,['sip:announcement@synthetic.invalid','revoke',`tel:${input.target}`]);
});
test('watchdog unavailable destination ends silent call once under the shared durable claim',async t=>{
 const f=await fixture(t);let refs=0,ends=0;
 const run=store=>controller(store,async()=>refs++,{hangup:async()=>ends++});
 const options={...greetingInput,target:''};
 const result=await run(f.store)(options);assert.equal(result.status,'call_ended_no_audio');
 assert.deepEqual(await run(await f.build())(options),result);
 assert.equal(ends,1);assert.equal(refs,0);
 assert.equal((await run(await f.build())(input)).reason,'transfer_intent_conflict');assert.equal(refs,0);
});
test('watchdog missing persistence and invalid identity cannot start relay, REFER, capture or hangup',async()=>{
 let effects=0;
 const run=store=>controller(store,async()=>effects++,{relay:announcementRelay({start:async()=>effects++}),hangup:async()=>effects++});
 const options={...greetingInput,prepare:async()=>effects++};
 assert.equal((await run(undefined)(options)).reason,'durable_transfer_store_required');
 for(const patch of [{callId:''},{tenant:null},{tenant:{tenantId:''}},{kind:'unknown'}]) {
   assert.equal((await run({claimAttempt:async()=>effects++,finishAttempt(){}})({...options,...patch})).reason,'invalid_transfer_identity');
 }
 assert.equal(effects,0);
});
test('watchdog delayed REFER acceptance after timeout never hangs up or replays after restart',async t=>{
 const f=await fixture(t);let refs=0,ends=0;const entered=deferred(),release=deferred();
 const run=store=>controller(store,async()=>{refs++;entered.resolve();return release.promise;},{hangup:async()=>ends++});
 const work=run(f.store)(greetingInput);await completesWithin(entered.promise);f.expireDeadline();
 const result=await completesWithin(work);assert.equal(result.status,'transfer_uncertain');
 release.resolve();await nextTurn();
 assert.deepEqual(await run(await f.build())(greetingInput),result);
 assert.equal(refs,1);assert.equal(ends,0);
});
for(const step of ['claim','prepare','start','cancel','hangup']) test(`watchdog bounded ${step} stall and delayed acknowledgment cannot create duplicate fallback`,async t=>{
 const f=await fixture(t);const entered=deferred(),release=deferred();let refs=0,ends=0,starts=0;
 const stall=async()=>{entered.resolve();return release.promise;};
 const store=step==='claim'?{claimAttempt:async(key,intent)=>{const receipt=await f.store.claimAttempt(key,intent);await stall();return receipt;},finishAttempt:f.store.finishAttempt.bind(f.store)}:f.store;
 const relay=announcementRelay({
   start:async()=>{starts++;if(step==='start')await stall();return {id:'announcement',targetUri:'sip:announcement@synthetic.invalid'};},
   waitForEntry:async()=>step!=='cancel',cancelPending:step==='cancel'?stall:async()=>true,
 });
 const extra=step==='hangup'?{hangup:async()=>{ends++;await stall();}}:{relay,hangup:async()=>ends++};
 const options={...greetingInput,...(step==='hangup'?{target:''}:{}),prepare:step==='prepare'?stall:async()=>({})};
 const work=controller(store,async()=>refs++,extra)(options);
 await completesWithin(entered.promise);f.expireDeadline();const result=await completesWithin(work);
 if(step==='prepare') assert.equal(result.status,'announcement_started');
 else assert.equal(result.status,'transfer_uncertain');
 release.resolve(true);await nextTurn();
 const before={refs,ends,starts};
 await controller(await f.build(),async()=>refs++,extra)(options);
 assert.deepEqual({refs,ends,starts},before);
 if(['claim','start','hangup'].includes(step))assert.equal(refs,0);
 if(step==='cancel')assert.equal(refs,1);
});
test('watchdog crash after provider acceptance before durable receipt remains fenced',async t=>{
 const f=await fixture(t);let refs=0,ends=0;
 const broken={claimAttempt:f.store.claimAttempt.bind(f.store),finishAttempt:async(key,patch)=>{
   if(patch.phase?.endsWith('_accepted'))throw Error('synthetic crash');
   return f.store.finishAttempt(key,patch);
 }};
 const extra={relay:announcementRelay(),hangup:async()=>ends++};
 assert.equal((await controller(broken,async()=>refs++,extra)(greetingInput)).status,'transfer_uncertain');
 await controller(await f.build(),async()=>refs++,extra)(greetingInput);
 await controller(await f.build(),async()=>refs++,extra)(input);
 assert.equal(refs,1);assert.equal(ends,0);
});
test('server watchdog has no transfer bypass and uses the normal controller authority',async()=>{
 const {readFile}=await import('node:fs/promises');const source=await readFile(new URL('../server.js',import.meta.url),'utf8');
 const watchdog=source.slice(source.indexOf('let fallbackStarted = false;'),source.indexOf('ws.on("open"'));
 assert.match(watchdog,/await guardedTransfer\(/);assert.match(watchdog,/kind: "greeting_fallback"/);
 assert.doesNotMatch(watchdog,/warmTransfer\.(start|failed)|referRealtimeCall\(|hangupRealtimeCall\(/);
 assert.equal((source.match(/referRealtimeCall\(/g)||[]).length,1,'REFER is injected only into the shared controller');
});
