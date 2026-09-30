import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Pool} from 'pg';
import {initializeLabDatabase} from '../scripts/private-voice-lab-start.mjs';
import {verifyValidatedProductionMigration} from '../src/postgres-server-stores.js';
const connectionString=process.env.POSTGRES_TEST_URL;
test('private voice lab initializes empty Postgres once across two pools and preserves later calls',{skip:!connectionString},async()=>{
  const url=new URL(connectionString);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));assert.equal(url.pathname,'/bookedradar_test');
  const a=new Pool({connectionString}),b=new Pool({connectionString});
  const roots=await Promise.all([1,2].map(()=>fs.mkdtemp(path.join(os.tmpdir(),'private-lab-test-'))));
  try {
    await a.query('DROP SCHEMA IF EXISTS bookedradar CASCADE');
    const [first,second]=await Promise.all([initializeLabDatabase(a,roots[0],connectionString),initializeLabDatabase(b,roots[1],connectionString)]);
    assert.equal(first,second);
    assert.equal((await verifyValidatedProductionMigration(a,{migrationId:'private_voice_lab_empty_20260929',snapshotFingerprint:first})).validated,true);
    await a.query("INSERT INTO bookedradar.call_control_state(call_id,tenant_id,updated_at,payload) VALUES('private-test','synthetic-hvac',now(),'{}')");
    assert.equal(await initializeLabDatabase(b,roots[1],connectionString),first);
    assert.equal((await a.query("SELECT count(*)::int AS count FROM bookedradar.call_control_state")).rows[0].count,1);
  } finally {
    await a.query('DROP SCHEMA IF EXISTS bookedradar CASCADE');await a.end();await b.end();
    for(const root of roots)await fs.rm(root,{recursive:true,force:true});
  }
});
