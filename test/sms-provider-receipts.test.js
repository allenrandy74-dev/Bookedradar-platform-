import { useJsonMemoryView } from "../src/json-file-transaction.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import { TwilioSmsAdapter } from '../src/integrations/twilio-sms.js';
import { RecoveryStore } from '../src/recovery/store.js';
import { ActionDispatcher } from '../src/integrations/dispatcher.js';
const context={contact:{phone:'+14095550100'},content:'Synthetic'};
const adapter=()=>new TwilioSmsAdapter({accountSid:'synthetic',authToken:'synthetic',fromNumber:'+14095550101'});
const sid='SM'+'a'.repeat(32);
test('SMS malformed success and failed/inbound statuses require reconciliation without another send',async t=>{
  for(const body of ['', '{}', 'null', 'not-json',JSON.stringify({sid:'invalid',status:'queued'}),...['failed','undelivered','canceled','receiving','received','unknown',null].map(status=>JSON.stringify({sid,status}))]){
    let calls=0;const mock=t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(body,{status:200});});
    await assert.rejects(adapter().send(context),e=>e.reconciliationRequired===true&&e.message==='twilio_sms_acceptance_unverified');assert.equal(calls,1);mock.mock.restore();
  }
});
test('valid SMS provider acceptance preserves provider state without claiming delivery',async t=>{
  for(const status of ['accepted','scheduled','queued','sending','sent','delivered']){
    const mock=t.mock.method(globalThis,'fetch',async()=>Response.json({sid,status}));const result=await adapter().send(context);
    assert.equal(result.accepted,true);assert.equal(result.sid,sid);assert.equal(result.status,status);assert.equal(result.delivered,undefined);mock.mock.restore();
  }
});

test('legacy dispatch holds unverified provider acceptance rather than automatically resending',async()=>{
  const store=new RecoveryStore('/tmp/unused-sms-receipt.json');useJsonMemoryView(store);store.persist=async()=>{};
  const tenant={tenantId:'synthetic',policies:{sms:{allowTransactionalWhenInbound:true}}};
  await store.upsertContact('synthetic:phone',{tenantId:'synthetic',phone:'+14095550100'});
  const opportunity=await store.createOpportunity({tenantId:'synthetic',contactKey:'synthetic:phone'});
  await store.scheduleAction({tenantId:'synthetic',contactKey:'synthetic:phone',opportunityId:opportunity.id,channel:'sms',purpose:'transactional',template:'missed_call_ack',dueAt:new Date(0).toISOString()});
  let sends=0;const dispatcher=new ActionDispatcher({store,tenant,adapters:{sms:{send:async()=>{sends++;throw Object.assign(new Error('twilio_sms_acceptance_unverified'),{reconciliationRequired:true});}}}});
  const result=await dispatcher.runOnce();assert.equal(result[0].reconciliationRequired,true);
  await dispatcher.runOnce({now:new Date(Date.now()+3600000)});assert.equal(sends,1);
});

test('ordinary fenced playbook SMS uses the contact approved by the final transaction',async()=>{
  const action={id:'a',tenantId:'synthetic',contactKey:'synthetic:c',opportunityId:'o',channel:'sms',purpose:'transactional',template:'missed_call_ack'};
  const stale={phone:'+14095550100',transactionalSmsAllowed:true};
  const authoritative={phone:'+14095550101',transactionalSmsAllowed:true};let recipient;
  const store={getOpportunity:async()=>({id:'o',status:'open'}),getContact:async()=>stale,
    beginDispatch:async()=>({...action,status:'dispatching',dispatchContact:authoritative}),finishClaim:async(_id,_claim,patch)=>({...action,...patch})};
  const worker=new ActionDispatcher({store,tenant:{tenantId:'synthetic'},adapters:{sms:{send:async request=>{recipient=request.contact.phone;assert.equal(request.action.dispatchContact,undefined);return {accepted:true};}}}});
  await worker.runFencedAction(action,new Date());assert.equal(recipient,authoritative.phone);
});
