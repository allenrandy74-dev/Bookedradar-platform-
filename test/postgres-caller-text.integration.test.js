import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PostgresRecoveryStore } from '../src/postgres-recovery-store.js';
import { RecoveryEngine } from '../src/recovery/engine.js';
import { ActionDispatcher } from '../src/integrations/dispatcher.js';

const connectionString=process.env.POSTGRES_TEST_URL;
test('real Postgres: caller text fences duplicates, rollback, stale consent and recipient changes',{skip:!connectionString},async()=>{
  const url=new URL(connectionString);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));assert.equal(url.pathname,'/bookedradar_test');
  const {Pool}=await import('pg');const pool=new Pool({connectionString,max:10});
  try{
    await pool.query('DROP SCHEMA IF EXISTS bookedradar CASCADE');await pool.query(await fs.readFile(new URL('../db/postgres-schema.sql',import.meta.url),'utf8'));
    const tenant={tenantId:'synthetic',playbooks:{phone_lead:[{channel:'human_task',template:'synthetic',purpose:'service',offsetMs:86400000}]}};
    const store=new PostgresRecoveryStore(pool,tenant.tenantId),engine=new RecoveryEngine({store,tenant});
    const lead=await engine.ingest({idempotencyKey:'caller-text-seed',type:'phone_lead',contact:{phone:'+14095550100',transactionalSmsAllowed:true},metadata:{callId:'call-a'}});
    const request={tenantId:tenant.tenantId,callId:'call-a',toolCallId:'tool-a',callerRequested:true,confirmedCallbackNumber:'+14095550100',content:'Synthetic requested text',to:'+14095550100',contactKey:lead.opportunity.contactKey,opportunityId:lead.opportunity.id};
    const results=await Promise.all(Array.from({length:30},()=>store.queueCallerTextOnce(request,tenant)));
    assert.equal(results.filter(x=>x.queued).length,1);assert.equal(results.filter(x=>x.duplicate).length,29);
    assert.equal((await new PostgresRecoveryStore(pool,tenant.tenantId).queueCallerTextOnce(request,tenant)).duplicate,true);
    assert.equal((await store.queueCallerTextOnce({...request,content:'Changed'},tenant)).reason,'caller_text_request_conflict');
    await assert.rejects(store.queueCallerTextOnce({...request,tenantId:'other'},tenant),/tenant_mismatch/);
    let sends=0;const intercepted=Object.create(store);
    for(const method of ['claimDueActions','getOpportunity','getContact','finishClaim'])intercepted[method]=store[method].bind(store);
    intercepted.beginDispatch=async(...args)=>{await store.upsertContact(request.contactKey,{suppressed:true});return store.beginDispatch(...args);};
    const blocked=await new ActionDispatcher({store:intercepted,tenant,adapters:{sms:{send:async()=>{sends++;}}}}).runOnce();
    assert.equal(sends,0);assert.equal(blocked[0].action.status,'blocked');assert.equal(blocked[0].action.blockedReason,'contact_suppressed');
    await store.upsertContact(request.contactKey,{suppressed:false});
    await pool.query("ALTER TABLE bookedradar.recovery_actions ADD CONSTRAINT reject_caller_text CHECK (payload->>'content' <> 'reject-synthetic') NOT VALID");
    const rejected={...request,toolCallId:'tool-b',content:'reject-synthetic'};
    await assert.rejects(store.queueCallerTextOnce(rejected,tenant));
    await pool.query('ALTER TABLE bookedradar.recovery_actions DROP CONSTRAINT reject_caller_text');
    assert.equal((await store.queueCallerTextOnce(rejected,tenant)).queued,true);
    intercepted.beginDispatch=async(...args)=>{await store.upsertContact(request.contactKey,{phone:'+14095550199'});return store.beginDispatch(...args);};
    const changed=await new ActionDispatcher({store:intercepted,tenant,adapters:{sms:{send:async()=>{sends++;}}}}).runOnce();
    assert.equal(sends,0);assert.equal(changed[0].action.blockedReason,'sms_recipient_changed');
    await store.upsertContact(request.contactKey,{phone:request.to});
    assert.equal((await store.queueCallerTextOnce({...request,toolCallId:'tool-c'},tenant)).queued,true);
    intercepted.getContact=async key=>({...await store.getContact(key),phone:'+14095550199'});
    intercepted.beginDispatch=store.beginDispatch.bind(store);
    let recipient;
    await new ActionDispatcher({store:intercepted,tenant,adapters:{sms:{send:async ({contact})=>{recipient=contact.phone;return {accepted:true};}}}}).runOnce();
    assert.equal(recipient,request.to);

  }finally{await pool.end();}
});
