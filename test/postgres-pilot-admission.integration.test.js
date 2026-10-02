import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Pool} from 'pg';
import {reserveProofPilotCall,readProofPilotSnapshot} from '../src/proof-pilot-admission.js';
import {PostgresCallHistoryStore} from '../src/postgres-call-history.js';
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
    await t.test('pending and uncertain bookings pause new admission without clearing or aging out holds',async()=>{
      for (const status of ['pending','uncertain']) {
        const tenantId=`booking-${status}`;
        const payload={tenantId,bookingAttempt:{attemptId:'held',status}};
        await pool.query("INSERT INTO bookedradar.call_control_state(call_id,tenant_id,updated_at,payload) VALUES ($1,$2,'2020-01-01',$3)",[tenantId,tenantId,JSON.stringify(payload)]);
        const held=await Promise.all(Array.from({length:10},(_,i)=>reserve(tenantId,`${tenantId}-${i}`)));
        assert.ok(held.every(r=>!r.admitted && r.reason==='booking_review_required' && r.status.unresolvedBookings===1));
        assert.deepEqual((await pool.query('SELECT payload FROM bookedradar.call_control_state WHERE call_id=$1',[tenantId])).rows[0].payload,payload);
        assert.equal((await pool.query('SELECT count(*)::int AS n FROM bookedradar.voice_calls WHERE tenant_id=$1',[tenantId])).rows[0].n,0);
      }
      assert.equal((await reserve('unaffected-booking-tenant','unaffected')).admitted,true);
      for (const status of ['confirmed','unconfirmed']) {
        const tenantId=`booking-${status}`;
        await pool.query("INSERT INTO bookedradar.call_control_state(call_id,tenant_id,updated_at,payload) VALUES ($1,$1,now(),$2)",[tenantId,JSON.stringify({bookingAttempt:{status}})]);
        assert.equal((await reserve(tenantId,`${tenantId}-next`)).admitted,true);
      }
      assert.equal((await reserve('unsafe-stop','unsafe',{stopOnCriticalFailure:false})).reason,'pilot_not_ready');
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM bookedradar.voice_calls WHERE tenant_id='unsafe-stop'")).rows[0].n,0);
    });
    await t.test('legacy calls inside the pilot window count toward the cap',async()=>{
      await pool.query("INSERT INTO bookedradar.voice_calls(call_id,tenant_id,started_at,updated_at,payload) VALUES ('legacy','tenant-legacy',now(),now(),'{}')");
      assert.equal((await reserve('tenant-legacy','next',{maxCalls:1})).reason,'call_cap_reached');
    });

    await t.test('status and admission share unresolved action and fallback readiness evidence',async()=>{
      const result=await readProofPilotSnapshot(pool,{tenantId:'tenant-uncertain',config});
      assert.equal(result.status.status,'PAUSED');assert.equal(result.status.stopReason,'critical_failure');
      assert.equal(result.criticalActionFailures,1);
      const bad={...config,carrierFallbackAccepted:false};
      const blocked=await readProofPilotSnapshot(pool,{tenantId:'unaccepted',config:bad});
      assert.equal(blocked.status.status,'BLOCKED');
      assert.ok(blocked.status.blockers.includes('carrier_fallback_acceptance_required'));
      assert.equal((await reserve('unaccepted','must-not-admit',bad)).admitted,false);
    });
    await t.test('durable voice failures pause only the affected tenant and count each call once',async()=>{
      const at=Date.now();
      const payload={callId:'critical-voice',tenantId:'voice-failed',startedAt:Date.parse('2020-01-01'),milestones:{
        'transfer.failed':{firstAt:at,lastAt:at,count:2},'lead.persist_failed':{firstAt:at,lastAt:at,count:1}
      }};
      await pool.query("INSERT INTO bookedradar.voice_calls(call_id,tenant_id,started_at,updated_at,payload) VALUES ('critical-voice','voice-failed','2020-01-01',now(),$1)",[JSON.stringify(payload)]);
      assert.equal((await reserve('voice-failed','after-failure')).reason,'critical_failure');
      const status=await readProofPilotSnapshot(pool,{tenantId:'voice-failed',config});
      assert.equal(status.criticalVoiceFailures,1);assert.equal(status.callsHandled,0);
      assert.equal((await reserve('voice-unaffected','separate-tenant')).admitted,true);
      payload.milestones={'transfer.failed':{firstAt:1,lastAt:2,count:1}};
      await pool.query("UPDATE bookedradar.voice_calls SET payload=$1 WHERE call_id='critical-voice'",[JSON.stringify(payload)]);
      assert.equal((await reserve('voice-failed','historical-only')).admitted,true);
    });
    await t.test('reservation metadata survives normal history start and restart replay',async()=>{
      assert.equal((await reserve('preserve-reservation','preserved')).admitted,true);
      const history=new PostgresCallHistoryStore(pool,'preserve-reservation');
      const before=await history.get('preserved');
      await history.start('preserved',{tenantId:'preserve-reservation',callerMasked:'***0100'});
      const after=await history.get('preserved');
      assert.equal(after.startedAt,before.startedAt);assert.deepEqual(after.pilotAdmission,before.pilotAdmission);
      assert.equal((await reserve('preserve-reservation','preserved')).duplicate,true);
      assert.equal((await readProofPilotSnapshot(pool,{tenantId:'preserve-reservation',config})).callsHandled,1);
    });
    await t.test('status counts exact pilot window and does not change rows',async()=>{
      const end=new Date(Date.parse(config.startAt)+14*86400000).toISOString();
      await pool.query("INSERT INTO bookedradar.voice_calls(call_id,tenant_id,started_at,updated_at,payload) VALUES ('window-before','window','2020-01-01',now(),'{}'),('window-end','window',$1,now(),'{}')",[end]);
      const before=(await pool.query("SELECT call_id,payload FROM bookedradar.voice_calls WHERE tenant_id='window' ORDER BY call_id")).rows;
      assert.equal((await readProofPilotSnapshot(pool,{tenantId:'window',config})).callsHandled,0);
      assert.deepEqual((await pool.query("SELECT call_id,payload FROM bookedradar.voice_calls WHERE tenant_id='window' ORDER BY call_id")).rows,before);
    });

  }finally{await pool.query('DROP SCHEMA IF EXISTS bookedradar CASCADE');await pool.end();}
});
