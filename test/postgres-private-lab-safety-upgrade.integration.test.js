import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Pool} from 'pg';
import os from 'node:os';
import path from 'node:path';
import {readPostgresSnapshot,exportPostgresPlatform} from '../src/postgres-full-export.js';
import {runPostgresTransactionalRestoreDrill} from '../src/postgres-restore-drill.js';
import {validateLabReleaseReadiness} from '../scripts/private-voice-lab-start.mjs';
import {PostgresAttemptStore,PostgresCallStateStore} from '../src/postgres-state-store.js';
import {PostgresRecoveryStore} from '../src/postgres-recovery-store.js';

// Fixture is byte-identical to lab/private-voice-runtime commit
// dab669d1ea97c11ee70e154fb6f1c73e0674530c, db/postgres-schema.sql.
// Git blob 1837f99cef800187d6700faa0f05983d6f990978; no comments added to SQL bytes.
const OLD_SHA256='da0e04e21a7b8d70c65f8a5044f11956fabf3721cb70bd3ca295c2d52279e92f';
const connectionString=process.env.POSTGRES_TEST_URL;
const q=name=>{assert.match(name,/^[a-z_]+$/);return '"'+name+'"';};
const tableNames=sql=>[...new Set([...sql.matchAll(/CREATE TABLE IF NOT EXISTS bookedradar\.([a-z_]+)/g)].map(m=>m[1]))];
async function snapshot(pool,tables) {
  const rows={};
  for(const name of tables)rows[name]=(await pool.query(`SELECT to_jsonb(t) AS row FROM bookedradar.${q(name)} t ORDER BY to_jsonb(t)::text`)).rows.map(r=>r.row);
  const sequences={};
  for(const {sequencename} of (await pool.query("SELECT sequencename FROM pg_sequences WHERE schemaname='bookedradar' ORDER BY sequencename")).rows) {
    sequences[sequencename]=(await pool.query(`SELECT last_value::text AS last_value,is_called FROM bookedradar.${q(sequencename)}`)).rows[0];
  }
  return {rows,sequences};
}
async function shape(pool) {
  return (await pool.query("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='bookedradar' ORDER BY tablename,indexname")).rows;
}
async function restore(pool,schema,saved) {
  // Real logical fixture restore: rebuild exact supplied schema, every table row
  // and every sequence. No pg_dump subprocess or production connection is used.
  await pool.query('DROP SCHEMA IF EXISTS bookedradar CASCADE');
  await pool.query(schema);
  for(const name of tableNames(schema)) {
    const rows=saved.rows[name];assert.ok(rows,`snapshot table missing: ${name}`);
    if(rows.length)await pool.query(`INSERT INTO bookedradar.${q(name)} SELECT * FROM jsonb_populate_recordset(NULL::bookedradar.${q(name)},$1::jsonb)`,[JSON.stringify(rows)]);
  }
  for(const [name,state] of Object.entries(saved.sequences))await pool.query('SELECT setval($1::regclass,$2::bigint,$3::boolean)',['bookedradar.'+name,state.last_value,state.is_called]);
}
async function readOnlyPreflight(pool) {
  const client=await pool.connect();
  try {
    await client.query('SET default_transaction_read_only=on');
    return await validateLabReleaseReadiness({connect:async()=>({query:(...args)=>client.query(...args),release(){}})});
  } finally {await client.query('SET default_transaction_read_only=off');client.release();}
}

test('real Postgres: exact old private-lab migration and logical restore preserve receipts and lab-only state',{skip:!connectionString,timeout:60000},async()=>{
  const url=new URL(connectionString);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/bookedradar_test');
  const pool=new Pool({connectionString,max:5,connectionTimeoutMillis:5000,statement_timeout:10000});
  const exportRoot=await fs.mkdtemp(path.join(os.tmpdir(),'private-lab-export-refusal-'));
  const oldSchema=await fs.readFile(new URL('./fixtures/private-lab-schema-dab669d1.sql',import.meta.url),'utf8');
  assert.equal(createHash('sha256').update(oldSchema).digest('hex'),OLD_SHA256);
  const newSchema=await fs.readFile(new URL('../db/postgres-schema.sql',import.meta.url),'utf8');
  const oldTables=tableNames(oldSchema),newTables=tableNames(newSchema);
  assert.ok(oldTables.includes('ops_notifications'));assert.ok(newTables.includes('ops_notifications'));
  const tenant='synthetic-hvac',contactKey=tenant+':+12025550101',stamp='2026-09-29T12:00:00.000Z',fingerprint='a'.repeat(64);
  const booking={attemptId:'historical-booking',requestHash:'b'.repeat(64),status:'uncertain',result:{confirmed:false}};
  try {
    await pool.query('DROP SCHEMA IF EXISTS bookedradar CASCADE');await pool.query(oldSchema);
    await pool.query(`INSERT INTO bookedradar.migration_runs VALUES($1,$2,$3,$3,'validated','{}'::jsonb,$4::jsonb)`,['private_voice_lab_empty_20260929',fingerprint,stamp,JSON.stringify({tableCounts:{ok:true},content:{ok:true,sourceContentHash:fingerprint,postgresContentHash:fingerprint}})]);
    await pool.query('INSERT INTO bookedradar.webhook_receipts VALUES($1,$2)',['synthetic-webhook',stamp]);
    await pool.query('INSERT INTO bookedradar.transfer_webhook_receipts VALUES($1,$2)',['synthetic-transfer-webhook',stamp]);
    await pool.query('INSERT INTO bookedradar.call_control_state VALUES($1,$2,$3,$4::jsonb)',['synthetic-call',tenant,stamp,JSON.stringify({tenantId:tenant,bookingAttempt:booking,marker:'preserve-call'})]);
    await pool.query('INSERT INTO bookedradar.recovery_contacts VALUES($1,$2,$3,$4::jsonb)',[contactKey,tenant,stamp,JSON.stringify({tenantId:tenant,contactKey,phone:'+12025550101',suppressed:true,optedOut:true,updatedAt:stamp})]);
    await pool.query(`INSERT INTO bookedradar.recovery_events(event_id,tenant_id,idempotency_key,contact_key,occurred_at,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,['legacy-event',tenant,'legacy-source-key',contactKey,stamp,JSON.stringify({id:'legacy-event',tenantId:tenant,type:'manual_note',idempotencyKey:'legacy-source-key',contactKey,occurredAt:stamp})]);
    await pool.query('INSERT INTO bookedradar.recovery_event_keys VALUES($1,$2,$3),($1,$4,$3)',[tenant,'legacy-source-key','legacy-event','manual-legacy-alias']);
    await pool.query(`INSERT INTO bookedradar.recovery_actions(action_id,tenant_id,contact_key,channel,status,due_at,payload) VALUES($1,$2,$3,'human_task','reconciliation_required',$4,$5::jsonb)`,['historical-dispatch',tenant,contactKey,stamp,JSON.stringify({id:'historical-dispatch',tenantId:tenant,contactKey,channel:'human_task',status:'reconciliation_required',providerReceipt:{id:'synthetic-known-receipt'},dispatchIntent:{token:'synthetic-old-writer'}})]);
    await pool.query(`INSERT INTO bookedradar.ops_incidents(incident_key,scope_key,severity,payload) VALUES('synthetic-incident','synthetic-hvac','critical',$1::jsonb)`,[JSON.stringify({marker:'lab-only-configuration',notificationsEnabled:false})]);
    await pool.query(`INSERT INTO bookedradar.ops_notifications(notification_id,incident_key,state,provider_receipt,payload) VALUES('synthetic-notification','synthetic-incident','uncertain','synthetic-notification-receipt',$1::jsonb)`,[JSON.stringify({attemptId:'synthetic-notification-intent',marker:'must-survive'})]);
    const oldSnapshot=await snapshot(pool,oldTables),oldShape=await shape(pool);
    const incomplete=/postgres_platform_export_requires_all_table_backup_for_ops_state/;
    await assert.rejects(readPostgresSnapshot(pool),incomplete);
    await assert.rejects(exportPostgresPlatform(pool,path.join(exportRoot,'must-not-exist'),{writersQuiesced:true}),incomplete);
    await assert.rejects(fs.stat(path.join(exportRoot,'must-not-exist')),{code:'ENOENT'});
    await assert.rejects(runPostgresTransactionalRestoreDrill(pool,newSchema,{drillId:'synthetic_ops_preservation'}),incomplete);
    assert.deepEqual(await snapshot(pool,oldTables),oldSnapshot,'incomplete platform backup/restore refusal changed data');
    assert.deepEqual(await shape(pool),oldShape,'incomplete platform restore refusal changed schema');
    await assert.rejects(readOnlyPreflight(pool),/postgres_release_schema_migration_required/);
    assert.deepEqual(await snapshot(pool,oldTables),oldSnapshot,'failed old-schema preflight changed data');
    assert.deepEqual(await shape(pool),oldShape,'failed old-schema preflight changed indexes');
    await pool.query(newSchema);await pool.query(newSchema);
    assert.equal(await readOnlyPreflight(pool),fingerprint);
    assert.deepEqual(await snapshot(pool,oldTables),oldSnapshot,'idempotent schema upgrade changed legacy table rows/sequences');
    const recovery=new PostgresRecoveryStore(pool,tenant);
    assert.equal((await recovery.snapshot()).eventKeys[JSON.stringify([tenant,'manual-legacy-alias'])],'legacy-event');
    assert.equal((await recovery.getContact(contactKey)).suppressed,true);
    const calls=new PostgresCallStateStore(pool,tenant);
    assert.deepEqual((await calls.getCall('synthetic-call')).bookingAttempt,booking);
    await assert.rejects(calls.claimBooking('synthetic-call',{attemptId:'forbidden-new-booking',requestHash:'c'.repeat(64)}),/booking_authority_unavailable/);
    assert.deepEqual((await calls.getCall('synthetic-call')).bookingAttempt,booking);
    assert.equal((await calls.listBookingReview()).attempts[0].attemptId,booking.attemptId);
    const attempts=new PostgresAttemptStore(pool),intent={tenantId:tenant,callId:'synthetic-new-call',kind:'transfer',target:'+12025550102',fingerprint:'synthetic-new-intent'};
    const claim=await attempts.claimAttempt('new-permanent-attempt',intent);assert.equal(claim.claimed,true);
    await attempts.finishAttempt('new-permanent-attempt',{...intent,claimToken:claim.record.claimToken,status:'uncertain'});
    const newSnapshot=await snapshot(pool,newTables),newShape=await shape(pool);
    // Old backup restored exactly still fails NEW readiness, preventing an unsafe
    // code-only rollback or accidental startup against a pre-upgrade database.
    await restore(pool,oldSchema,oldSnapshot);
    assert.deepEqual(await snapshot(pool,oldTables),oldSnapshot);assert.deepEqual(await shape(pool),oldShape);
    await assert.rejects(readOnlyPreflight(pool),/postgres_release_schema_migration_required/);
    assert.equal((await pool.query("SELECT to_regclass('bookedradar.provider_attempt_receipts') AS name")).rows[0].name,null);
    // Restore the latest compatible snapshot, including new uncertain intent.
    await restore(pool,oldSchema+'\n'+newSchema,newSnapshot); // Reproduce the exact upgraded schema/index topology.
    assert.deepEqual(await snapshot(pool,newTables),newSnapshot);assert.deepEqual(await shape(pool),newShape);
    assert.equal(await readOnlyPreflight(pool),fingerprint);
    assert.equal((await new PostgresAttemptStore(pool).claimAttempt('new-permanent-attempt',intent)).claimed,false);
    assert.deepEqual(await snapshot(pool,newTables),newSnapshot,'replay mutated restored durable state');
    console.log(JSON.stringify({privateLabUpgradeRestore:true,oldSchemaSha256:OLD_SHA256,oldTables:oldTables.length,newTables:newTables.length,readOnlyPreflight:true,legacyStatePreserved:true,oldRestoreRejected:true,newRestoreCompatible:true,permanentAttemptReplayFenced:true,incompletePlatformBackupRefused:true,scope:'synthetic logical table-and-sequence restore; not pg_dump/PITR or live Render migration'}));
  } finally {await pool.query('DROP SCHEMA IF EXISTS bookedradar CASCADE');await pool.end();await fs.rm(exportRoot,{recursive:true,force:true});}
});
