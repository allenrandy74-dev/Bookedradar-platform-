import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Pool } from 'pg';
import { PostgresRecoveryStore } from '../src/postgres-recovery-store.js';
import { ActionDispatcher } from '../src/integrations/dispatcher.js';
import { RecoveryEngine } from '../src/recovery/engine.js';

const connectionString=process.env.POSTGRES_TEST_URL;
test('real Postgres: application dispatcher fences sends and ambiguous outcomes', {skip:!connectionString},async t=>{
  const url=new URL(connectionString);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));assert.equal(url.pathname,'/bookedradar_test');
  const pool=new Pool({connectionString,max:10});
  const tenant={tenantId:'t1',timeZone:'America/Chicago',policies:{},playbooks:{missed_call:[{channel:'human_task',template:'synthetic',purpose:'service',offsetMs:0}]}};
  const store=new PostgresRecoveryStore(pool,'t1');
  const engine=new RecoveryEngine({store,tenant});
  const seed=async key=>(await engine.ingest({id:key,idempotencyKey:key,type:'missed_call',occurredAt:new Date(Date.now()-60000).toISOString(),contact:{name:'Synthetic',phone:'+14095550111'}})).actions[0];
  const dispatcher=(adapter,s=store)=>new ActionDispatcher({store:s,tenant,adapters:{human_task:adapter}});
  try {
    await pool.query('DROP SCHEMA IF EXISTS bookedradar CASCADE');await pool.query(await fs.readFile(new URL('../db/postgres-schema.sql',import.meta.url),'utf8'));
    await t.test('parallel dispatcher instances send and complete once',async()=>{
      const action=await seed('success');let sends=0;
      await Promise.all(Array.from({length:8},()=>dispatcher({send:async()=>{sends++;return {id:'synthetic-provider'};}}).runOnce()));
      assert.equal(sends,1);assert.equal((await store.snapshot()).actions[action.id].status,'completed');
    });
    await t.test('provider timeout becomes a reconciliation item and is never automatically resent',async()=>{
      const action=await seed('timeout');let sends=0;
      const worker=dispatcher({send:async()=>{sends++;throw new Error('synthetic timeout after possible acceptance');}});
      const result=await worker.runOnce();assert.equal(result[0].reconciliationRequired,true);
      await worker.runOnce({now:new Date(Date.now()+3600000)});
      assert.equal(sends,1);assert.equal((await store.snapshot()).actions[action.id].status,'reconciliation_required');
      assert.ok((await store.reconciliationActions()).some(a=>a.id===action.id));
    });
    await t.test('provider success followed by completion-write failure cannot enter retry path',async()=>{
      const action=await seed('commit-failure');let sends=0;
      const failing=Object.create(store);
      // Bind private-field methods to their real instance, overriding completion only.
      for(const method of ['claimDueActions','getOpportunity','getContact','beginDispatch'])failing[method]=store[method].bind(store);
      failing.finishClaim=async()=>{throw new Error('completion_write_failed');};
      await assert.rejects(dispatcher({send:async()=>{sends++;return {id:'accepted'};}},failing).runOnce(),/completion_write_failed/);
      assert.equal((await store.snapshot()).actions[action.id].status,'dispatching');
      await dispatcher({send:async()=>{sends++;}}).runOnce({now:new Date(Date.now()+3600000)});
      assert.equal(sends,1);
      assert.ok((await store.reconciliationActions()).some(a=>a.id===action.id));
    });
    await t.test('crash after durable send intent does not allow another worker to resend',async()=>{
      const action=await seed('crash');const claimed=(await store.claimDueActions({workerId:'crashed',leaseMs:1000}))[0];
      assert.equal(claimed.id,action.id);await store.beginDispatch(action.id,claimed);
      assert.deepEqual(await store.claimDueActions({workerId:'other',now:new Date(Date.now()+10000)}),[]);
      assert.ok((await store.reconciliationActions()).some(a=>a.id===action.id));
    });
    await t.test('expired ownership is rejected before a provider call',async()=>{
      await seed('stale');const oldNow=new Date(Date.now()-10000);
      const action=(await store.claimDueActions({workerId:'old',now:oldNow,leaseMs:1000}))[0];
      let sends=0;await assert.rejects(dispatcher({send:async()=>{sends++;}}).runFencedAction(action,new Date()),/stale_recovery_claim/);
      assert.equal(sends,0);
    });
    await t.test('application engine updates recovered opportunity and attribution atomically',async()=>{
      const state=await store.snapshot();const opportunity=Object.values(state.opportunities)[0];
      const result=await engine.markRecovered(opportunity.id,{bookingId:'synthetic-booking'});
      assert.equal(result.opportunity.recovered,true);assert.equal(result.attribution.bookingId,'synthetic-booking');
      assert.ok(Array.isArray(await engine.dueActions()));
      const before=await store.snapshot();
      await pool.query("ALTER TABLE bookedradar.recovery_attribution ADD CONSTRAINT reject_booking CHECK (payload->>'bookingId' <> 'reject') NOT VALID");
      await assert.rejects(engine.markRecovered(opportunity.id,{bookingId:'reject'}));
      assert.deepEqual(await store.snapshot(),before);
      await pool.query('ALTER TABLE bookedradar.recovery_attribution DROP CONSTRAINT reject_booking');
    });
    await t.test('operator resolution is tenant-scoped, revision-checked, audited and idempotent',async()=>{
      const pending=(await store.reconciliationActions()).find(a=>a.status==='reconciliation_required');
      const input={decision:'confirmed_sent',resolutionId:'resolve_timeout_1',expectedRevision:pending.reconciliationRevision,evidence:'Synthetic provider lookup confirms acceptance',actor:'synthetic_admin'};
      await assert.rejects(new PostgresRecoveryStore(pool,'t2').reconcileAction(pending.id,input),/action_not_found/);
      await assert.rejects(store.reconcileAction(pending.id,{...input,expectedRevision:'0'.repeat(64)}),/stale_reconciliation_revision/);
      assert.throws(()=>store.reconcileAction(pending.id,{...input,decision:'retry'}),/reconciliation_decision_invalid/);
      const competing={...input,decision:'cancelled',resolutionId:'resolve_timeout_2'};
      const results=await Promise.allSettled([store.reconcileAction(pending.id,input),store.reconcileAction(pending.id,competing)]);
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
      const index=results.findIndex(r=>r.status==='fulfilled');const winning=index===0 ? input : competing;
      assert.equal((await store.reconcileAction(pending.id,winning)).duplicate,true);
      await assert.rejects(store.reconcileAction(pending.id,{...winning,evidence:'Changed evidence'}),/reconciliation_id_conflict/);
      const state=await store.snapshot();assert.equal(state.events.filter(e=>e.type==='action_reconciled').length,1);
      assert.notEqual(state.actions[pending.id].status,'pending');
      assert.ok(!(await store.reconciliationActions()).some(a=>a.id===pending.id));
    });
    await t.test('operator cannot resolve a send with an active worker lease',async()=>{
      const action=await seed('active-resolution');
      const claims=await store.claimDueActions({workerId:'active-review',leaseMs:60000});const claim=claims.find(a=>a.id===action.id);
      await store.beginDispatch(action.id,claim);
      const current=(await store.reconciliationActions()).find(a=>a.id===action.id);
      await assert.rejects(store.reconcileAction(action.id,{decision:'cancelled',resolutionId:'active_resolution',expectedRevision:current.reconciliationRevision,evidence:'Synthetic review',actor:'synthetic_admin'}),/dispatch_still_active/);
    });
  } finally {await pool.query('DROP SCHEMA IF EXISTS bookedradar CASCADE');await pool.end();}
});
