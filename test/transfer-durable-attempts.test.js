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
