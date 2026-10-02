import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { RecoveryStore } from '../src/recovery/store.js';
import { queueCallerText, persistCallerText } from '../src/caller-text-queue.js';
import { ActionDispatcher } from '../src/integrations/dispatcher.js';

async function fixture() {
  const tenant={tenantId:'t1',features:{callerTexting:true},integrations:{sms:{enabled:true}},commercial:{dispatchMode:'live'}};
  const raw=new RecoveryStore('/tmp/unused-caller-text.json');raw.loaded=true;raw.persist=async()=>{};
  const contactKey='t1:crm-contact';await raw.upsertContact(contactKey,{tenantId:'t1',phone:'+14095550100',transactionalSmsAllowed:true});
  const opportunity=await raw.createOpportunity({tenantId:'t1',contactKey,type:'phone_lead',metadata:{callId:'call-a'}});
  const call={tenantId:'t1',opportunityId:opportunity.id,lastLead:{callback_number:'+14095550100'}};
  let serial=Promise.resolve();const store={tenantId:'t1',getOpportunity:id=>raw.getOpportunity(id),queueCallerTextOnce(req,t){const result=serial.then(()=>persistCallerText(raw,t,req));serial=result.catch(()=>{});return result;}};
  return {raw,call,args:{tenant,store,state:{getCall:async()=>call},callId:'call-a',toolCallId:'tool-a',callerRequested:true,confirmedCallbackNumber:'+14095550100',content:'Your requested directions.',env:{DISPATCH_ENABLED:'true'}}};
}

test('caller texting fails closed without gates, durable identity and captured call context',async t=>{
  for(const kind of ['global','tenant','feature','sms','store','identity','calltenant','callback','opportunity','requested','confirmed','mismatch'])await t.test(kind,async()=>{
    const f=await fixture();if(kind==='global')f.args.env.DISPATCH_ENABLED='false';if(kind==='tenant')f.args.tenant.commercial.dispatchMode='shadow';if(kind==='feature')f.args.tenant.features.callerTexting=false;if(kind==='sms')f.args.tenant.integrations.sms.enabled=false;if(kind==='store')f.args.store={};if(kind==='identity')delete f.args.toolCallId;if(kind==='calltenant')f.call.tenantId='other';if(kind==='callback')delete f.call.lastLead;if(kind==='opportunity')f.call.opportunityId='unknown';if(kind==='requested')f.args.callerRequested=false;if(kind==='confirmed')delete f.args.confirmedCallbackNumber;if(kind==='mismatch')f.args.confirmedCallbackNumber='+14095550199';
    assert.equal((await queueCallerText(f.args)).queued,false);assert.equal(Object.keys(f.raw.data.actions).length,0);
  });
});

test('same call/tool identity is atomic, replay-safe and rejects changed content',async()=>{
  const f=await fixture();const results=await Promise.all(Array.from({length:30},()=>queueCallerText(f.args)));
  assert.equal(results.filter(x=>x.queued).length,1);assert.equal(results.filter(x=>x.duplicate).length,29);
  assert.equal(Object.keys(f.raw.data.actions).length,1);
  const altered=await queueCallerText({...f.args,content:'Changed request'});assert.equal(altered.reason,'caller_text_request_conflict');
  assert.equal((await queueCallerText({...f.args,toolCallId:'tool-b'})).queued,true);
});

test('suppressed, unconsented, closed and changed-recipient records cannot queue',async()=>{
  for(const kind of ['suppressed','consent','closed','recipient']){
    const f=await fixture();const key='t1:crm-contact';
    if(kind==='suppressed')await f.raw.upsertContact(key,{suppressed:true});
    if(kind==='consent')await f.raw.upsertContact(key,{transactionalSmsAllowed:false});
    if(kind==='recipient')await f.raw.upsertContact(key,{phone:'+14095550199'});
    if(kind==='closed')await f.raw.patchOpportunity(f.call.opportunityId,{status:'closed'});
    assert.equal((await queueCallerText(f.args)).queued,false);
  }
});

test('caller-text uses stored content and respects final database suppression decision',async()=>{
  const f=await fixture();await queueCallerText(f.args);let sent=0;
  const claimStore={tenantId:'t1',claimDueActions:o=>f.raw.claimDueActions(o),getOpportunity:id=>f.raw.getOpportunity(id),getContact:key=>f.raw.getContact(key),
    beginDispatch:async(id,claim,now,tenant)=>{assert.equal(tenant.tenantId,'t1');return {...claim,status:'blocked',blockedReason:'contact_suppressed'};},finishClaim:async()=>{throw new Error('unexpected completion');}};
  const dispatcher=new ActionDispatcher({store:claimStore,tenant:f.args.tenant,adapters:{sms:{send:async()=>{sent++;}}}});
  const result=await dispatcher.runOnce({now:new Date(Date.now()+1000)});assert.equal(sent,0);assert.equal(result[0].action.blockedReason,'contact_suppressed');
});

test('voice tool queues and returns truthful status without direct provider send',async()=>{
  const source=await fs.readFile(new URL('../server.js',import.meta.url),'utf8');
  const section=source.slice(source.indexOf('  if (name === "send_caller_text")'),source.indexOf('  if (name === "end_call")'));
  const f=await fixture();const handler=new Function('deps',`return async function(){const {name,tenant,callId,toolCallId,args,state,recoveryStore,competitiveFeaturesForTenant,dispatcherFor,queueCallerText}=deps;${section}}`)({name:'send_caller_text',tenant:f.args.tenant,callId:f.args.callId,toolCallId:f.args.toolCallId,args:{content:f.args.content,caller_requested_text:true,confirmed_callback_number:'+14095550100'},state:f.args.state,recoveryStore:{forTenant:()=>f.args.store},competitiveFeaturesForTenant:t=>t.features,dispatcherFor:()=>({adapters:{sms:{send(){throw Error('direct send forbidden');}}}}),queueCallerText:input=>queueCallerText({...input,env:f.args.env})});
  const result=await handler();assert.equal(result.queued,true);assert.equal(result.sent,false);assert.match(result.message,/not delivery confirmation/);
  assert.match(source,/toolCallId: dedupeKey/);assert.doesNotMatch(section,/adapters\.sms\.send/);
});
