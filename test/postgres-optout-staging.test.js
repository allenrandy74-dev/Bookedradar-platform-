import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresRecoveryStore, RECOVERY_TABLES } from '../src/postgres-recovery-store.js';
const tenant={tenantId:'t',playbooks:{}};
const contactKey='t:+14095550100';
// SQL sequencing model only. This exercises adapter transaction boundaries and
// rollback decisions; it is not a substitute for real PostgreSQL lock tests.
function fixture({legacy=false}={}) {
  let db=Object.fromEntries(RECOVERY_TABLES.map(([,table])=>[table,{}]));
  db.recovery_contacts[contactKey]={tenantId:'t',contactKey,phone:'+14095550100'};
  db.recovery_opportunities.opp={id:'opp',tenantId:'t',contactKey,status:'open'};
  db.recovery_actions.action={id:'action',tenantId:'t',opportunityId:'opp',contactKey,status:'pending',channel:'sms'};
  db.recovery_event_keys={};
  if(legacy){db.recovery_events.old={id:'old',type:'contact_opted_out',idempotencyKey:'legacy-key',opportunityId:'opp',contactKey,occurredAt:'2026-01-01T00:00:00Z'};db.recovery_event_keys['legacy-key']='old';}
  const history=[];let rejectCleanup=false;
  const pool={connect:async()=>{
    let working;
    return {release(){history.push('RELEASE');},query:async(sql,values=[])=>{
      history.push(sql.trim().split('\n')[0]);
      if(sql.startsWith('BEGIN')){working=structuredClone(db);return {rows:[]};}
      if(sql==='COMMIT'){db=working;return {rows:[]};}
      if(sql==='ROLLBACK'){return {rows:[]};}
      if(sql.startsWith('SET')||sql.includes('pg_advisory'))return {rows:[]};
      if(sql.startsWith('SELECT tenant_id,event_key'))return {rows:Object.entries(working.recovery_event_keys).map(([event_key,event_id])=>({tenant_id:'t',event_key,event_id}))};
      if(sql.startsWith('SELECT')){const table=sql.match(/FROM bookedradar\.(\w+)/)[1];return {rows:Object.entries(working[table]).map(([id,payload])=>({id,payload:structuredClone(payload)}))};}
      if(sql.startsWith('DELETE FROM bookedradar.recovery_event_keys')){working.recovery_event_keys={};return {rows:[]};}
      if(sql.startsWith('INSERT INTO bookedradar.recovery_event_keys')){working.recovery_event_keys[values[1]]=values[2];return {rows:[]};}
      if(sql.startsWith('INSERT INTO bookedradar.')){
        const table=sql.match(/INSERT INTO bookedradar\.(\w+)/)[1];const item=JSON.parse(values.at(-1));
        if(rejectCleanup&&table==='recovery_actions'&&item.cancelledReason==='contact_opted_out')throw new Error('synthetic_cleanup_failure');
        working[table][values[0]]=item;return {rows:[{id:values[0]}]};
      }
      throw new Error('Unexpected SQL: '+sql);
    }};
  }};
  return {pool,history,set rejectCleanup(value){rejectCleanup=value;},get db(){return db;}};
}

test('SQL sequencing: STOP commits suppression before cleanup failure and replay repairs it',async()=>{
  const f=fixture();f.rejectCleanup=true;
  const store=new PostgresRecoveryStore(f.pool,'t');
  const event={type:'contact_opted_out',idempotencyKey:'stop',opportunityId:'opp'};
  await assert.rejects(store.ingest(event,tenant),/synthetic_cleanup_failure/);
  assert.equal(f.db.recovery_contacts[contactKey].suppressed,true);
  assert.equal(f.db.recovery_opportunities.opp.status,'closed');
  assert.equal(Object.keys(f.db.recovery_events).length,1);
  assert.equal(f.db.recovery_actions.action.status,'pending');
  assert.equal(f.history.filter(sql=>sql==='COMMIT').length,1);
  assert.equal(f.history.filter(sql=>sql==='ROLLBACK').length,1);
  f.rejectCleanup=false;
  const result=await new PostgresRecoveryStore(f.pool,'t').ingest(event,tenant);
  assert.equal(result.duplicate,true);assert.equal(result.cancelledActions,1);
  assert.equal(f.db.recovery_actions.action.status,'cancelled');
  assert.equal(Object.keys(f.db.recovery_events).length,1);
});

test('SQL sequencing: no-key STOP uses one stable generated event ID across its two commits',async()=>{
  const f=fixture();const store=new PostgresRecoveryStore(f.pool,'t');
  const result=await store.ingest({type:'contact_opted_out',opportunityId:'opp'},tenant);
  assert.equal(result.duplicate,undefined);assert.equal(result.cancelledActions,1);
  assert.equal(Object.keys(f.db.recovery_events).length,1);
  assert.equal(f.history.filter(sql=>sql==='COMMIT').length,2);
});

test('SQL sequencing: invalid STOP and nested outer transaction fail before connecting',async()=>{
  const pool={connect:async()=>{throw new Error('should_not_connect');}};
  const store=new PostgresRecoveryStore(pool,'t');
  await assert.rejects(store.ingest({type:'contact_opted_out'},tenant),/identity required/i);
  const nested=new PostgresRecoveryStore({...pool,requiresOuterCommit:true},'t');
  await assert.rejects(nested.ingest({type:'contact_opted_out',opportunityId:'opp'},tenant),/optout_requires_top_level_transaction/);
});

test('SQL sequencing: legacy SQL-owned STOP payload with missing tenant replays without a second event',async()=>{
  const f=fixture({legacy:true});const store=new PostgresRecoveryStore(f.pool,'t');
  const result=await store.ingest({type:'contact_opted_out',idempotencyKey:'legacy-key',opportunityId:'opp'},tenant);
  assert.equal(result.duplicate,true);assert.equal(result.cancelledActions,1);
  assert.deepEqual(Object.keys(f.db.recovery_events),['old']);
  assert.equal(f.db.recovery_events.old.tenantId,undefined,'read-only inference does not silently rewrite historical payload');
});

test('SQL sequencing: ordinary events retain one transaction',async()=>{
  const f=fixture();const store=new PostgresRecoveryStore(f.pool,'t');
  await store.ingest({type:'custom',contact:{phone:'+14095550100'}},tenant);
  assert.equal(f.history.filter(sql=>sql==='COMMIT').length,1);
});

test('SQL sequencing: final dispatch fence rechecks persisted caller-text attestation and requires tenant',async()=>{
  const f=fixture();const now=new Date();
  Object.assign(f.db.recovery_actions.action,{status:'processing',template:'caller_text',expectedRecipient:'+14095550100',confirmedCallbackNumber:'+14095550100',callerRequested:false,
    claimedBy:'worker',claimedAt:now.toISOString(),claimExpiresAt:new Date(now.getTime()+60000).toISOString()});
  const claim=structuredClone(f.db.recovery_actions.action);
  const store=new PostgresRecoveryStore(f.pool,'t');
  await assert.rejects(store.beginDispatch('action',claim,now),/dispatch_tenant_mismatch/);
  const result=await store.beginDispatch('action',claim,now,tenant);
  assert.equal(result.status,'blocked');assert.equal(result.blockedReason,'sms_confirmation_binding_required');
  assert.equal(f.db.recovery_actions.action.status,'blocked');
});
