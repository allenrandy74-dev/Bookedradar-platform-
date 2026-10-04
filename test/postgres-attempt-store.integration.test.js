import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PostgresAttemptStore,exportPostgresCallState } from '../src/postgres-state-store.js';
import { JsonStateStore } from '../src/state-store.js';
import { readPostgresSnapshot } from '../src/postgres-full-export.js';
import { buildPostgresMigrationManifest } from '../src/postgres-migration-audit.js';
import { importMigrationManifest,reconcileMigration } from '../src/postgres-runtime.js';
const connectionString=process.env.POSTGRES_TEST_URL;

test('real PostgreSQL: permanent provider intents fence concurrent claims and survive export/import', {skip:!connectionString},async()=>{
  const url=new URL(connectionString);
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
  assert.equal(url.pathname,'/bookedradar_test');
  const {Pool}=await import('pg');
  const pool=new Pool({connectionString,max:10});
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pg-attempt-test-'));
  const schema=await fs.readFile(new URL('../db/postgres-schema.sql',import.meta.url),'utf8');
  const intent={tenantId:'synthetic',callId:'call',target:'+14095550101',kind:'transfer',fingerprint:'fixture'};
  try {
    await pool.query('DROP SCHEMA IF EXISTS bookedradar CASCADE');await pool.query(schema);
    const stores=Array.from({length:30},()=>new PostgresAttemptStore(pool));
    const claims=await Promise.all(stores.map(store=>store.claimAttempt('attempt',intent)));
    assert.equal(claims.filter(item=>item.claimed).length,1);
    const token=claims.find(item=>item.claimed).record.claimToken;
    for(const field of Object.keys(intent)) await assert.rejects(stores[0].claimAttempt('attempt',{...intent,[field]:'other'}),/attempt_intent_conflict/);
    await assert.rejects(stores[0].finishAttempt('attempt',{...intent,claimToken:'stale',status:'accepted'}),/attempt_claim_conflict/);
    await stores[0].finishAttempt('attempt',{...intent,claimToken:token,status:'pending',phase:'before_refer'});
    // Database rejects receipt write after simulated provider acceptance. Persisted
    // intent must remain blocking through a fresh adapter and JSON rollback.
    await pool.query(`CREATE FUNCTION bookedradar.reject_attempt_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_receipt_failure'; END $$`);
    await pool.query(`CREATE TRIGGER reject_receipt BEFORE UPDATE ON bookedradar.provider_attempt_receipts FOR EACH ROW WHEN (NEW.payload->>'status'='accepted') EXECUTE FUNCTION bookedradar.reject_attempt_update()`);
    await assert.rejects(stores[0].finishAttempt('attempt',{...intent,claimToken:token,status:'accepted'}),/synthetic_receipt_failure/);
    const retry=await new PostgresAttemptStore(pool).claimAttempt('attempt',intent);
    assert.equal(retry.claimed,false);assert.equal(retry.record.status,'pending');
    const exported=await exportPostgresCallState(pool,root,{writersQuiesced:true});
    const json=new JsonStateStore(exported.file);
    assert.equal((await json.claimAttempt('attempt',intent)).claimed,false);
    const snapshot=await readPostgresSnapshot(pool);
    const manifest=buildPostgresMigrationManifest(snapshot);
    await pool.query('DROP SCHEMA bookedradar CASCADE');await pool.query(schema);
    await importMigrationManifest(pool,manifest,{migrationId:'synthetic-attempt-restore'});
    assert.equal((await reconcileMigration(pool,manifest)).ok,true);
    const restored=new PostgresAttemptStore(pool);
    assert.equal((await restored.claimAttempt('attempt',intent)).claimed,false);
    const finishes=await Promise.allSettled(stores.map(store=>store.finishAttempt('attempt',{...intent,claimToken:token,status:'uncertain'})));
    assert.equal(finishes.filter(item=>item.status==='fulfilled').length,1);
    assert.ok(finishes.filter(item=>item.status==='rejected').every(item=>/attempt_claim_conflict/.test(item.reason.message)));
    await assert.rejects(restored.finishAttempt('attempt',{...intent,claimToken:token,status:'accepted'}),/attempt_claim_conflict/);
    assert.equal((await restored.claimAttempt('attempt',intent)).record.status,'uncertain');
  } finally {await pool.query('DROP SCHEMA IF EXISTS bookedradar CASCADE');await pool.end();await fs.rm(root,{recursive:true,force:true});}
});
