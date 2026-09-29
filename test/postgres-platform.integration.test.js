import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Pool } from 'pg';
import { PostgresRecoveryStore } from '../src/postgres-recovery-store.js';
import { PostgresWebChatStore,PostgresTransferStore,PostgresGrowthMetricsStore } from '../src/postgres-aux-stores.js';
import { exportPostgresPlatform } from '../src/postgres-full-export.js';
import { PostgresCallStateStore,PostgresWebhookStore } from '../src/postgres-state-store.js';
import { PostgresCallHistoryStore } from '../src/postgres-call-history.js';
import { PostgresLeadStore } from '../src/postgres-lead-store.js';
import { PostgresBillingStore } from '../src/billing/postgres-store.js';
import { importMigrationManifest,reconcileMigration } from '../src/postgres-runtime.js';
import { buildPostgresMigrationManifest,stableHash } from '../src/postgres-migration-audit.js';
import { RecoveryStore } from '../src/recovery/store.js';
import { WebChatStore } from '../src/web-chat.js';
import { GrowthMetricsStore } from '../src/growth-metrics.js';

const connectionString=process.env.POSTGRES_TEST_URL;
test('real Postgres: remaining stores and full platform reverse-export rehearsal', {skip:!connectionString}, async t=>{
  const url=new URL(connectionString);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));assert.equal(url.pathname,'/bookedradar_test');
  const pool=new Pool({connectionString,max:10});const root=await fs.mkdtemp(path.join(os.tmpdir(),'br-full-drill-'));
  const schema=await fs.readFile(new URL('../db/postgres-schema.sql',import.meta.url),'utf8');
  const tenant={tenantId:'t1',businessName:'Synthetic',timeZone:'America/Chicago',policies:{bookingMode:'confirm_only',sms:{allowTransactionalWhenInbound:true}},economics:{defaultAverageJobValue:500}};
  const recovery=new PostgresRecoveryStore(pool,'t1'); let opportunity;
  try {
    await pool.query('DROP SCHEMA IF EXISTS bookedradar CASCADE');await pool.query(schema);
    await t.test('20 duplicate recovery ingestions commit exactly one workflow',async()=>{
      const event={id:'event-1',idempotencyKey:'t1:event-1',type:'missed_call',occurredAt:'2026-09-28T15:00:00Z',contact:{name:'Synthetic',phone:'+14095550111',transactionalSmsAllowed:true}};
      const results=await Promise.all(Array.from({length:20},()=>recovery.ingest(event,tenant)));
      assert.equal(results.filter(r=>!r.duplicate).length,1);
      const state=await recovery.snapshot();assert.equal(state.events.length,1);assert.equal(Object.keys(state.opportunities).length,1);assert.ok(Object.keys(state.actions).length>0);
      opportunity=Object.values(state.opportunities)[0];
      assert.equal(await new PostgresRecoveryStore(pool,'t2').getOpportunity(opportunity.id),null);
    });
    await t.test('failed workflow leaves no event receipt or partial contact',async()=>{
      const before=await recovery.snapshot();
      await pool.query("ALTER TABLE bookedradar.recovery_actions ADD CONSTRAINT reject_new_action CHECK (payload->>'template' IS NULL) NOT VALID");
      await assert.rejects(recovery.ingest({id:'failed-event',idempotencyKey:'failed-event',type:'missed_call',contact:{phone:'+14095550112',transactionalSmsAllowed:true}},tenant));
      assert.deepEqual(await recovery.snapshot(),before);
      await pool.query('ALTER TABLE bookedradar.recovery_actions DROP CONSTRAINT reject_new_action');
    });
    await t.test('parallel workers claim each action once and expired owner cannot finish',async()=>{
      const now=new Date('2026-10-01T15:00:00Z');
      const batches=await Promise.all(Array.from({length:8},(_,i)=>recovery.claimDueActions({now,workerId:'worker-'+i,leaseMs:1000})));
      const claimed=batches.flat();assert.ok(claimed.length>0);assert.equal(new Set(claimed.map(a=>a.id)).size,claimed.length);
      const later=new Date(now.getTime()+2000);
      const reclaimed=await recovery.claimDueActions({now:later,workerId:'replacement',leaseMs:60000});assert.equal(reclaimed.length,claimed.length);
      await assert.rejects(recovery.finishClaim(claimed[0].id,claimed[0],{status:'completed'},later),/stale_recovery_claim/);
      await recovery.finishClaim(reclaimed[0].id,reclaimed[0],{status:'completed',completedAt:later.toISOString()},later);
      assert.equal((await recovery.snapshot()).actions[reclaimed[0].id].status,'completed');
    });
    await t.test('chat rejects stale concurrent writes and cross-tenant changes',async()=>{
      const chat=new PostgresWebChatStore(pool,'t1');const session=await chat.getOrCreate();
      const results=await Promise.allSettled([chat.update(session.id,{fields:{name:'A'}},{expectedRevision:0}),chat.update(session.id,{fields:{name:'B'}},{expectedRevision:0})]);
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(results.find(r=>r.status==='rejected').reason.message,/stale_chat_revision/);
      const other=new PostgresWebChatStore(pool,'t2');await assert.rejects(other.update(session.id,{fields:{}},{expectedRevision:1}),/record_tenant_conflict/);
      assert.notEqual((await other.getOrCreate(session.id)).id,session.id);
    });
    await t.test('transfer updates preserve concurrent fields and tenant ownership',async()=>{
      const transfers=new PostgresTransferStore(pool,'t1');
      await Promise.all(Array.from({length:20},(_,i)=>transfers.patchCall('transfer-1',{callId:'call-1',status:'pending',['field'+i]:i})));
      const record=await transfers.getCall('transfer-1');for(let i=0;i<20;i++)assert.equal(record['field'+i],i);
      await assert.rejects(new PostgresTransferStore(pool,'t2').patchCall('transfer-1',{}),/record_tenant_conflict/);
    });
    await t.test('growth counters preserve 50 simultaneous increments',async()=>{
      const metrics=new PostgresGrowthMetricsStore(pool);
      await Promise.all(Array.from({length:50},()=>metrics.record({event:'page_view',trade:'hvac',source:'synthetic',variant:'test'})));
      assert.equal((await metrics.summary()).counts['page_view|hvac|synthetic|test'],50);
    });
    await t.test('full export restores every store and reimports with matching records',async()=>{
      await new PostgresCallStateStore(pool,'t1').patchCall('call-1',{lead:'synthetic'});
      await new PostgresWebhookStore(pool).markWebhookOnce('hook-1');
      const history=new PostgresCallHistoryStore(pool,'t1');await history.start('call-1');await history.addTurn('call-1',{speaker:'caller',text:'Synthetic transcript'});
      await new PostgresLeadStore(pool,'t1').append({tenant_id:'t1',call_id:'call-1',name:'Synthetic'});
      for (const mode of ['test','live']) await new PostgresBillingStore(pool,{mode}).transaction(data=>{data.accounts.synthetic={tenantId:'t1',mode};});
      const exported=await exportPostgresPlatform(pool,root,{writersQuiesced:true});assert.equal(exported.files.length,9);
      const metadata=JSON.parse(await fs.readFile(path.join(exported.directory,'export-manifest.json'),'utf8'));
      for(const [name,hash] of Object.entries(metadata.hashes))assert.equal(crypto.createHash('sha256').update(await fs.readFile(path.join(exported.directory,name))).digest('hex'),hash);
      const restoredRecovery=new RecoveryStore(path.join(exported.directory,'recovery-state.json'));assert.deepEqual(await restoredRecovery.snapshot(),exported.snapshot.recovery);
      const restoredChat=new WebChatStore(path.join(exported.directory,'web-chat.json'));await restoredChat.load();assert.deepEqual(restoredChat.data,exported.snapshot.webChat);
      const restoredMetrics=new GrowthMetricsStore(path.join(exported.directory,'growth-metrics.json'));assert.deepEqual(await restoredMetrics.summary(),exported.snapshot.growthMetrics);
      const manifest=buildPostgresMigrationManifest(exported.snapshot);
      await pool.query('DROP SCHEMA bookedradar CASCADE');await pool.query(schema);
      await importMigrationManifest(pool,manifest,{migrationId:'synthetic-restore'});
      assert.equal((await reconcileMigration(pool,manifest)).ok,true);
      const second=await exportPostgresPlatform(pool,root,{writersQuiesced:true});
      assert.equal(stableHash(second.snapshot),stableHash(exported.snapshot));
      assert.notEqual(second.directory,exported.directory);
    });
    await t.test('full export refuses inconsistent transcript representations',async()=>{
      await pool.query("UPDATE bookedradar.call_turns SET text_content='inconsistent' WHERE call_id='call-1'");
      await assert.rejects(exportPostgresPlatform(pool,root,{writersQuiesced:true}),/transcript_reconciliation_failed/);
    });
  } finally {await pool.query('DROP SCHEMA IF EXISTS bookedradar CASCADE');await pool.end();await fs.rm(root,{recursive:true,force:true});}
});
