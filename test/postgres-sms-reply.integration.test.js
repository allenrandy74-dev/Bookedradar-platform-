import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PostgresRecoveryStore } from '../src/postgres-recovery-store.js';
import { RecoveryEngine } from '../src/recovery/engine.js';

const connectionString=process.env.POSTGRES_TEST_URL;
test('real Postgres: inbound SMS reply queue is atomic, durable and tenant isolated',{skip:!connectionString},async()=>{
  const url=new URL(connectionString);
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
  assert.equal(url.pathname,'/bookedradar_test');
  const {Pool}=await import('pg');const pool=new Pool({connectionString,max:10});
  try {
    await pool.query('DROP SCHEMA IF EXISTS bookedradar CASCADE');
    await pool.query(await fs.readFile(new URL('../db/postgres-schema.sql',import.meta.url),'utf8'));
    const tenant={tenantId:'synthetic',playbooks:{phone_lead:[]}};
    const store=new PostgresRecoveryStore(pool,tenant.tenantId);
    const seeded=await new RecoveryEngine({store,tenant}).ingest({id:'synthetic-seed',type:'estimate_sent',contact:{phone:'+14095550100',transactionalSmsAllowed:true}});
    const request={tenantId:tenant.tenantId,messageSid:'SM'+'a'.repeat(32),opportunityId:seeded.opportunity.id,contactKey:seeded.opportunity.contactKey,content:'Synthetic reply'};
    const results=await Promise.all(Array.from({length:30},()=>store.queueSmsReplyOnce(request,tenant)));
    assert.equal(results.filter(x=>x.queued).length,1);
    assert.equal(results.filter(x=>x.duplicate).length,29);
    assert.equal((await new PostgresRecoveryStore(pool,tenant.tenantId).queueSmsReplyOnce(request,tenant)).duplicate,true);
    await assert.rejects(store.queueSmsReplyOnce({...request,tenantId:'other'},tenant),/tenant_mismatch/);
    await store.upsertContact(request.contactKey,{suppressed:true});
    assert.equal((await store.queueSmsReplyOnce({...request,messageSid:'SM'+'b'.repeat(32)},tenant)).reason,'contact_suppressed');
    await store.upsertContact(request.contactKey,{suppressed:false});
    await pool.query("ALTER TABLE bookedradar.recovery_actions ADD CONSTRAINT reject_synthetic_reply CHECK (payload->>'content' <> 'reject-synthetic') NOT VALID");
    const rejected={...request,messageSid:'SM'+'c'.repeat(32),content:'reject-synthetic'};
    await assert.rejects(store.queueSmsReplyOnce(rejected,tenant));
    await pool.query('ALTER TABLE bookedradar.recovery_actions DROP CONSTRAINT reject_synthetic_reply');
    assert.equal((await store.queueSmsReplyOnce(rejected,tenant)).queued,true);
  } finally {await pool.end();}
});
