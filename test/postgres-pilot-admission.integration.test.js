import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Pool} from 'pg';
import {reserveProofPilotCall} from '../src/proof-pilot-admission.js';
const connectionString=process.env.POSTGRES_TEST_URL;
test('real Postgres: pilot slots are bounded across concurrent instances, replays and tenants',{skip:!connectionString},async t=>{
  const url=new URL(connectionString);
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
  assert.equal(url.pathname,'/bookedradar_test');
  const pool=new Pool({connectionString,max:10});
  const config={enabled:true,startAt:new Date(Date.now()-3600000).toISOString(),durationDays:14,maxCalls:25,customerApprovedScope:true,baselineDocumented:true,acceptancePassed:true,carrierFallbackAccepted:true,fallbackRejectStatusCode:486,fallbackAcceptanceReference:'synthetic-ci'};
  const reserve=(tenantId,callId,overrides={})=>reserveProofPilotCall(pool,{tenantId,callId,config:{...config,...overrides}});
  try{
    await pool.query('DROP SCHEMA IF EXISTS bookedradar CASCADE');
    await pool.query(await fs.readFile(new URL('../db/postgres-schema.sql',import.meta.url),'utf8'));
    await t.test('50 simultaneous calls reserve exactly 25 slots',async()=>{
      const results=await Promise.all(Array.from({length:50},(_,i)=>reserve('tenant-a',`a-${i}`)));
      assert.equal(results.filter(r=>r.admitted).length,25);
      assert.equal(results.filter(r=>r.reason==='call_cap_reached').length,25);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM bookedradar.voice_calls WHERE tenant_id='tenant-a'")).rows[0].n,25);
    });
    await t.test('replays do not consume slots or repeat provider decisions',async()=>{
      const results=await Promise.all(Array.from({length:10},()=>reserve('tenant-b','b-replay')));
      assert.equal(results.filter(r=>r.admitted).length,1);
      assert.equal(results.filter(r=>r.duplicate).length,9);
      assert.equal((await reserve('tenant-b','b-next')).callsReserved,2);
      await assert.rejects(reserve('tenant-c','b-replay'),/call_tenant_conflict/);
    });
    await t.test('expired, scheduled and manually paused pilots create no reservations',async()=>{
      assert.equal((await reserve('expired','e',{startAt:new Date(Date.now()-15*86400000).toISOString()})).reason,'time_cap_reached');
      assert.equal((await reserve('future','f',{startAt:new Date(Date.now()+86400000).toISOString()})).reason,'scheduled');
      assert.equal((await reserve('paused','p',{manuallyPaused:true})).reason,'manual_pause');
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM bookedradar.voice_calls WHERE tenant_id IN ('expired','future','paused')")).rows[0].n,0);
    });
    await t.test('historical critical failures do not pause a new pilot; current failures do',async()=>{
      const action={channel:'human_alert',createdAt:'2020-01-01T00:00:00Z'};
      await pool.query("INSERT INTO bookedradar.recovery_actions(action_id,tenant_id,channel,status,created_at,payload) VALUES ('critical','tenant-d','human_alert','failed','2020-01-01',$1)",[JSON.stringify(action)]);
      assert.equal((await reserve('tenant-d','d-1')).admitted,true);
      action.failedAt=new Date().toISOString();
      await pool.query("UPDATE bookedradar.recovery_actions SET payload=$1 WHERE action_id='critical'",[JSON.stringify(action)]);
      assert.equal((await reserve('tenant-d','d-2')).reason,'critical_failure');
    });
    await t.test('ambiguous critical dispatch outcomes pause admission',async()=>{
      const action={channel:'human_task',failedAt:new Date().toISOString()};
      await pool.query("INSERT INTO bookedradar.recovery_actions(action_id,tenant_id,channel,status,created_at,payload) VALUES ('uncertain','tenant-uncertain','human_task','reconciliation_required',now(),$1)",[JSON.stringify(action)]);
      assert.equal((await reserve('tenant-uncertain','u-1')).reason,'critical_failure');
    });
    await t.test('legacy calls inside the pilot window count toward the cap',async()=>{
      await pool.query("INSERT INTO bookedradar.voice_calls(call_id,tenant_id,started_at,updated_at,payload) VALUES ('legacy','tenant-legacy',now(),now(),'{}')");
      assert.equal((await reserve('tenant-legacy','next',{maxCalls:1})).reason,'call_cap_reached');
    });
    await t.test('guarded lab rehearsal cleans only its fixtures and preserves prior rows',async()=>{
      const before=(await pool.query('SELECT call_id,tenant_id,payload FROM bookedradar.voice_calls ORDER BY call_id')).rows;
      const script=new URL('../scripts/pilot-lab-admission-check.mjs',import.meta.url).pathname;
      const checkEnv={...process.env,DATABASE_URL:connectionString,PRIVATE_VOICE_LAB:'true',PRIVATE_VOICE_LAB_DATABASE_HOST:url.hostname,VOICE_ENABLED:'false',DISPATCH_ENABLED:'false',BOOKEDRADAR_BILLING_ENABLED:'false',OPS_ALERTS_ENABLED:'false'};
      await assert.rejects(promisify(execFile)(process.execPath,[script,'--expected-host=wrong-host'],{env:checkEnv}),/explicit_lab_host_mismatch/);
      await assert.rejects(promisify(execFile)(process.execPath,[script,`--expected-host=${url.hostname}`],{env:{...checkEnv,VOICE_ENABLED:'true'}}),/VOICE_ENABLED_must_be_disabled/);
      const {stdout}=await promisify(execFile)(process.execPath,[script,`--expected-host=${url.hostname}`],{env:checkEnv});
      const result=JSON.parse(stdout.trim());
      assert.equal(result.ok,true);assert.equal(result.admitted,25);assert.equal(result.providerCalls,0);assert.equal(result.syntheticRowsRemaining,0);
      assert.deepEqual((await pool.query('SELECT call_id,tenant_id,payload FROM bookedradar.voice_calls ORDER BY call_id')).rows,before);
    });
  }finally{await pool.query('DROP SCHEMA IF EXISTS bookedradar CASCADE');await pool.end();}
});
