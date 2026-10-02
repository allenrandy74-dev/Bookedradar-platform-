import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { RecoveryStore } from '../src/recovery/store.js';
import { queueSmsReply, persistSmsReply } from '../src/sms-reply-queue.js';
import { ActionDispatcher } from '../src/integrations/dispatcher.js';

async function fixture() {
  const tenant = {tenantId:'synthetic',commercial:{dispatchMode:'live'},features:{twoWaySms:true},integrations:{sms:{enabled:true}}};
  const contactKey='synthetic:+14095550100';
  const raw = new RecoveryStore('/tmp/sms-reply-unused.json');raw.loaded=true;raw.persist=async()=>{};
  await raw.upsertContact(contactKey,{tenantId:'synthetic',phone:'+14095550100',transactionalSmsAllowed:true});
  const opportunity=await raw.createOpportunity({tenantId:'synthetic',contactKey,type:'phone_lead'});
  let serial=Promise.resolve(),generated=0;
  const store={tenantId:'synthetic',getContact:key=>raw.getContact(key),smsReplyQueued:async sid=>Boolean(raw.data.eventKeys[`sms-reply:synthetic:${sid}`]),queueSmsReplyOnce(request,t){
    const next=serial.then(()=>persistSmsReply(raw,t,request));serial=next.catch(()=>{});return next;
  }};
  const args={tenant,store,env:{DISPATCH_ENABLED:'true'},contactKey,opportunity,recipient:'+14095550100',messageSid:'SM'+'a'.repeat(32),generate:async()=>{generated++;return 'The team will confirm your preferred time.';}};
  return {args,raw,generated:()=>generated};
}

test('global and tenant gates, capability, identity and durable storage fail closed',async t=>{
  for(const kind of ['global','tenant','feature','sms','identity','storage','wrongtenant'])await t.test(kind,async()=>{
    const f=await fixture();
    if(kind==='global')f.args.env.DISPATCH_ENABLED='false';
    if(kind==='tenant')f.args.tenant.commercial.dispatchMode='shadow';
    if(kind==='feature')f.args.tenant.features.twoWaySms=false;
    if(kind==='sms')f.args.tenant.integrations.sms.enabled=false;
    if(kind==='identity')f.args.messageSid='';
    if(kind==='storage')f.args.store={};
    if(kind==='wrongtenant')f.args.store.tenantId='other';
    assert.equal((await queueSmsReply(f.args)).queued,false);assert.equal(f.generated(),0);
    assert.equal(Object.keys(f.raw.data.actions).length,0);
  });
});

test('suppression before generation and during generation prevents queued reply',async()=>{
  const f=await fixture();await f.raw.upsertContact(f.args.contactKey,{suppressed:true});
  assert.equal((await queueSmsReply(f.args)).reason,'contact_suppressed');assert.equal(f.generated(),0);
  await f.raw.upsertContact(f.args.contactKey,{suppressed:false});
  f.args.generate=async()=>{await f.raw.upsertContact(f.args.contactKey,{optedOut:true});return 'No send';};
  assert.equal((await queueSmsReply(f.args)).reason,'contact_suppressed');
  assert.equal(Object.keys(f.raw.data.actions).length,0);
});

test('concurrent and replayed message IDs produce one queued action and no provider call',async()=>{
  const f=await fixture();const results=await Promise.all(Array.from({length:30},()=>queueSmsReply(f.args)));
  assert.equal(results.filter(x=>x.queued).length,1);
  assert.equal(results.filter(x=>x.duplicate).length,29);
  assert.equal(Object.keys(f.raw.data.actions).length,1);
  const beforeReplay=f.generated();assert.equal((await queueSmsReply(f.args)).duplicate,true);assert.equal(f.generated(),beforeReplay);
  const action=Object.values(f.raw.data.actions)[0];assert.equal(action.status,'pending');assert.match(action.content,/team will confirm/);
});

test('queued content travels through dispatcher compliance; opt-out blocks it',async()=>{
  const f=await fixture();await queueSmsReply(f.args);let sends=0;
  const dispatcher=new ActionDispatcher({store:f.raw,tenant:f.args.tenant,adapters:{sms:{async send(){sends++;}}}});
  await f.raw.upsertContact(f.args.contactKey,{suppressed:true});
  await dispatcher.runOnce({now:new Date(Date.now()+1000)});assert.equal(sends,0);
  assert.equal(Object.values(f.raw.data.actions)[0].status,'blocked');
});

test('dispatcher uses persisted reply rather than an unknown-template fallback',async()=>{
  const f=await fixture();await queueSmsReply(f.args);let content;
  const dispatcher=new ActionDispatcher({store:f.raw,tenant:f.args.tenant,adapters:{sms:{async send(request){content=request.content;return {accepted:true};}}}});
  await dispatcher.runOnce({now:new Date(Date.now()+1000)});assert.equal(content,'The team will confirm your preferred time.');
});

test('route retains STOP/control handling before queue and has no direct send',async()=>{
  const source=await fs.readFile(new URL('../server.js',import.meta.url),'utf8');
  const route=source.slice(source.indexOf('app.post("/twilio/sms"'),source.indexOf('app.get("/api/v1/actions/due"'));
  assert.ok(route.indexOf('isOptOutText(text)')<route.indexOf('queueSmsReply({'));
  assert.ok(route.indexOf('isSmsControlText(text)')<route.indexOf('queueSmsReply({'));
  assert.doesNotMatch(route,/adapters\.sms\.send/);
  assert.match(route,/messageSid, contactKey, opportunity/);
});

test('legacy reply without a bound recipient is blocked rather than sent',async()=>{
  const f=await fixture();await queueSmsReply(f.args);
  const action=Object.values(f.raw.data.actions)[0];delete action.expectedRecipient;let sends=0;
  await new ActionDispatcher({store:f.raw,tenant:f.args.tenant,adapters:{sms:{send:async()=>{sends++;}}}}).runOnce({now:new Date(Date.now()+1000)});
  assert.equal(sends,0);assert.equal(f.raw.data.actions[action.id].blockedReason,'sms_confirmation_binding_required');
});
