import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Pool} from 'pg';
import {validateExistingLabDatabase} from '../scripts/private-voice-lab-start.mjs';
const connectionString=process.env.POSTGRES_TEST_URL;
test('private lab startup validates existing migration without bootstrapping or changing rows',{skip:!connectionString},async t=>{
  const url=new URL(connectionString);
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));assert.equal(url.pathname,'/bookedradar_test');
  const pool=new Pool({connectionString});
  const fingerprint='a'.repeat(64),migrationId='private_voice_lab_empty_20260929';
  try {
    await pool.query('DROP SCHEMA IF EXISTS bookedradar CASCADE');
    await t.test('missing schema stays missing',async()=>{
      await assert.rejects(validateExistingLabDatabase(pool),/existing_database_required/);
      assert.equal((await pool.query("SELECT to_regnamespace('bookedradar') AS schema")).rows[0].schema,null);
    });
    await pool.query(await fs.readFile(new URL('../db/postgres-schema.sql',import.meta.url),'utf8'));
    await t.test('missing migration is refused',async()=>{
      await assert.rejects(validateExistingLabDatabase(pool),/validated_migration_required/);
    });
    await pool.query("INSERT INTO bookedradar.migration_runs VALUES ($1,$2,now(),now(),'validated','{}',$3)",[migrationId,fingerprint,JSON.stringify({tableCounts:{ok:true},content:{ok:true,sourceContentHash:'same',postgresContentHash:'same'}})]);
    await pool.query("INSERT INTO bookedradar.call_control_state(call_id,tenant_id,updated_at,payload) VALUES('preserved','synthetic-hvac',now(),'{}')");
    await t.test('concurrent validations preserve migration and existing calls',async()=>{
      const before=(await pool.query('SELECT * FROM bookedradar.migration_runs')).rows;
      assert.deepEqual(await Promise.all([validateExistingLabDatabase(pool),validateExistingLabDatabase(pool)]),[fingerprint,fingerprint]);
      assert.deepEqual((await pool.query('SELECT * FROM bookedradar.migration_runs')).rows,before);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM bookedradar.call_control_state')).rows[0].n,1);
    });
    await t.test('unvalidated migration is refused',async()=>{
      await pool.query("UPDATE bookedradar.migration_runs SET status='failed'");
      await assert.rejects(validateExistingLabDatabase(pool),/status_invalid/);
    });
    await t.test('unreconciled migration is refused',async()=>{
      await pool.query("UPDATE bookedradar.migration_runs SET status='validated',validation='{}'");
      await assert.rejects(validateExistingLabDatabase(pool),/reconciliation_invalid/);
    });
  } finally {await pool.query('DROP SCHEMA IF EXISTS bookedradar CASCADE');await pool.end();}
});
