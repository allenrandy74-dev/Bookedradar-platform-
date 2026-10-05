import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { RecoveryStore } from '../src/recovery/store.js';
import { ActionDispatcher } from '../src/integrations/dispatcher.js';
const tenant={tenantId:'synthetic-dispatch',policies:{maxDispatchAttempts:3},timeZone:'UTC'};
async function fixture(t) {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'br-dispatch-safe-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'recovery.json'),store=new RecoveryStore(file);
 await store.upsertContact('synthetic-dispatch:c',{tenantId:tenant.tenantId,name:'Synthetic'});
 await store.createOpportunity({id:'o',tenantId:tenant.tenantId,contactKey:'synthetic-dispatch:c'});
 await store.scheduleAction({id:'a',tenantId:tenant.tenantId,opportunityId:'o',contactKey:'synthetic-dispatch:c',channel:'human_alert',dueAt:new Date(0).toISOString()});
 return {file,store};
}
for(const result of [undefined,null,{},[],{accepted:true},{taskId:123},{taskId:' '}]) {
 test(`owner alert requires a usable receipt: ${JSON.stringify(result)}`,async t=>{
  const {file,store}=await fixture(t);let sends=0;
  const adapter={send:async()=>{sends++;return result;}};
  const first=await new ActionDispatcher({store,tenant,adapters:{human_alert:adapter}}).runOnce();
  assert.equal(first[0].dispatched,false);
  assert.equal((await store.snapshot()).actions.a.status,'reconciliation_required');
  await new ActionDispatcher({store:new RecoveryStore(file),tenant,adapters:{human_alert:adapter}}).runOnce({now:new Date(Date.now()+3600000)});
  assert.equal(sends,1);
 });
}
test('ambiguous local send and completion failure never authorize replay after restart',async t=>{
 const {file,store}=await fixture(t);let sends=0;
 const adapter={send:async()=>{sends++;throw new Error('synthetic response lost');}};
 await new ActionDispatcher({store,tenant,adapters:{human_alert:adapter}}).runOnce();
 await new ActionDispatcher({store:new RecoveryStore(file),tenant,adapters:{human_alert:adapter}}).runOnce({now:new Date(Date.now()+3600000)});
 assert.equal(sends,1);
});
test('send intent survives a failed completion receipt write',async t=>{
 const {file,store}=await fixture(t);let sends=0;
 const send=async()=>{sends++;return {taskId:'synthetic-task'};};
 store.finishClaim=async()=>{throw new Error('synthetic commit failure');};
 await assert.rejects(new ActionDispatcher({store,tenant,adapters:{human_alert:{send}}}).runOnce(),/commit failure/);
 const restart=new RecoveryStore(file);
 assert.equal((await restart.snapshot()).actions.a.status,'dispatching');
 await new ActionDispatcher({store:restart,tenant,adapters:{human_alert:{send}}}).runOnce({now:new Date(Date.now()+3600000)});
 assert.equal(sends,1);
});
test('custom store without durable dispatch authority refuses provider I/O',async()=>{
 let sends=0;
 const result=await new ActionDispatcher({store:{claimDueActions:async()=>[{id:'a',tenantId:tenant.tenantId,channel:'human_alert'}]},tenant,adapters:{human_alert:{send:async()=>{sends++;}}}}).runOnce();
 assert.equal(result[0].reason,'dispatch_authority_unavailable');assert.equal(sends,0);
});

for (const status of ['failed','canceled','undelivered','unknown']) {
 test(`SMS failed status is not accepted even with receipt ID: ${status}`,async()=>{
  let finish;
  const store={getOpportunity:async()=>({tenantId:tenant.tenantId}),getContact:async()=>({phone:'+12025550101',transactionalSmsAllowed:true}),beginDispatch:async()=>({status:'dispatching'}),finishClaim:async(_id,_claim,patch)=>(finish=patch,patch)};
  const smsTenant={...tenant,policies:{sms:{allowTransactionalWhenInbound:true}}};
  const result=await new ActionDispatcher({store,tenant:smsTenant,adapters:{sms:{send:async()=>({sid:'SM'+'a'.repeat(32),status})}}}).runFencedAction({id:'a',tenantId:tenant.tenantId,channel:'sms',purpose:'transactional',template:'missed_call_ack'},new Date());
  assert.equal(result.dispatched,false);
  assert.equal(finish.status,'reconciliation_required');
 });
}
