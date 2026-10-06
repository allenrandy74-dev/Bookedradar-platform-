import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { JsonStateStore } from '../src/state-store.js';
import { CallHistoryStore } from '../src/call-history.js';
import { proofPilotStatus, proofPilotReadiness } from '../src/proof-pilot-control.js';
import { reserveProofPilotCall, enforceProofPilotAdmission, pilotBookingHolds, pilotCriticalFailures, pilotCriticalVoiceCalls, pilotSafetySnapshot } from '../src/proof-pilot-admission.js';
const now=Date.parse('2026-10-04T12:00:00Z');
const config={enabled:true,startAt:'2026-10-04T00:00:00Z',durationDays:14,maxCalls:25,coverageMode:'after_hours',customerApprovedScope:true,baselineDocumented:true,acceptancePassed:true,carrierFallbackAccepted:true,fallbackRejectStatusCode:503,fallbackAcceptanceReference:'synthetic-only'};
async function scratch(t){ const dir=await fs.mkdtemp(path.join(os.tmpdir(),'caps-state-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir; }
// A deterministic SQL-shape adapter, deliberately NOT a PostgreSQL implementation.
function database({holds=0,actions=[],failInsert=false,invalidCount=false}={}){
 const calls=new Map(),queries=[];let released=0;
 const client={release(){released++;},async query(sql,args=[]){queries.push({sql,args});
 if(sql.includes('extract(epoch'))return {rows:[{now_ms:now}]};
 if(sql.startsWith('SELECT tenant_id,payload'))return {rows:calls.has(args[0])?[calls.get(args[0])]:[]};
 if(sql.includes('count(*)')&&sql.includes('voice_calls'))return {rows:[{n:invalidCount?'0':[...calls.values()].filter(c=>c.tenant_id===args[0]).length}]};
 if(sql.includes('recovery_actions'))return {rows:actions.map(payload=>({payload}))};
 if(sql.startsWith('SELECT call_id,payload'))return {rows:[]};
 if(sql.includes('count(*)')&&sql.includes('call_control_state'))return {rows:[{n:holds}]};
 if(sql.includes('INSERT INTO bookedradar.voice_calls')){if(failInsert)throw Error('synthetic_insert_failure');calls.set(args[0],{tenant_id:args[1],payload:JSON.parse(args[5])});return {rows:[]};}
 if(/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL|SELECT pg_advisory)/.test(sql))return {rows:[]};
 throw Error('unhandled_query:'+sql);
 }};
 return {calls,queries,client,pool:{async connect(){return client;}},get released(){return released;}};
}
test('pilot cap: 100 sequential attempts admit 25, reject 75; replay adds zero',async()=>{
 const db=database();let accepted=0;
 for(let i=0;i<100;i++)accepted+=Number((await reserveProofPilotCall(db.pool,{tenantId:'synthetic-a',callId:'cap-'+i,config})).admitted);
 assert.equal(accepted,25);assert.equal(db.calls.size,25);assert.equal(db.released,100);
 const replay=await reserveProofPilotCall(db.pool,{tenantId:'synthetic-a',callId:'cap-0',config});assert.equal(replay.duplicate,true);assert.equal(db.calls.size,25);
 assert.equal(db.queries.filter(q=>q.sql.includes('pg_advisory_xact_lock')).length,101);
 assert(db.queries.filter(q=>q.sql.includes('pg_advisory_xact_lock')).every(q=>q.args[0]==='bookedradar_pilot:synthetic-a'));
});
test('pilot status: exact caps, schedule, pause precedence and unsafe config',()=>{
 assert.equal(proofPilotStatus(config,{now,callsHandled:24}).status,'ACTIVE');
 assert.equal(proofPilotStatus(config,{now,callsHandled:25}).stopReason,'call_cap_reached');
 assert.equal(proofPilotStatus(config,{now:Date.parse(config.startAt)+14*86400000}).stopReason,'time_cap_reached');
 assert.equal(proofPilotStatus(config,{now:Date.parse(config.startAt)-1}).status,'SCHEDULED');
 assert.equal(proofPilotStatus(config,{now,callsHandled:25,unresolvedBookings:1}).stopReason,'booking_review_required');
 for(const patch of [{maxCalls:26},{durationDays:15},{stopOnCriticalFailure:false},{customerApprovedScope:false},{acceptancePassed:false}])assert.equal(proofPilotReadiness({...config,...patch}).ready,false);
});
test('pending/uncertain hold query is tenant-scoped and deliberately has no age cutoff',async()=>{
 const db=database({holds:1});assert.equal(await pilotBookingHolds(db.client,'synthetic-a'),1);
 const q=db.queries.at(-1);assert.deepEqual(q.args,['synthetic-a']);assert.match(q.sql,/pending.*uncertain/);assert.doesNotMatch(q.sql,/updated_at|created_at|interval/i);
 const s=await pilotSafetySnapshot(db.client,{tenantId:'synthetic-a',config,now});assert.equal(s.status.stopReason,'booking_review_required');
});
test('critical recovery timing: active claim excluded, expired and unknown counted',()=>{
 const active={status:'dispatching',channel:'human_alert',createdAt:new Date(now-100).toISOString(),claimExpiresAt:new Date(now+1000).toISOString()};
 assert.equal(pilotCriticalFailures([active],config,now),0);
 assert.equal(pilotCriticalFailures([{...active,claimExpiresAt:new Date(now-1).toISOString()},{status:'failed',channel:'human_task',failedAt:'invalid'},{status:'failed',channel:'email',lastError:'transfer failed',failedAt:new Date(now).toISOString()},{status:'failed',channel:'email',failedAt:new Date(now).toISOString()}],config,now),3);
 const calls=Array.from({length:100},(_,i)=>({call_id:'voice-'+i,payload:{milestones:{'transfer.failed':{firstAt:now-10,lastAt:now,count:100}}}}));
 assert.equal(pilotCriticalVoiceCalls([...calls,...calls],config,now),100);
});
test('missing pool/insert failure/unverified count reject closed with cleanup',async()=>{
 for(const pool of [null,database({failInsert:true}).pool,database({invalidCount:true}).pool]){
 let rejects=0,ends=0;const out=await enforceProofPilotAdmission({tenant:{tenantId:'synthetic-a',commercial:{proofPilot:config}},callId:'blocked',pool,reject:async()=>{rejects++;},end:()=>{ends++;}});
 assert.equal(out.handled,true);assert.equal(rejects,1);assert.equal(ends,1);
 }
 const db=database({failInsert:true});await assert.rejects(reserveProofPilotCall(db.pool,{tenantId:'synthetic-a',callId:'fail',config}),/synthetic_insert_failure/);assert(db.queries.some(q=>q.sql==='ROLLBACK'));assert.equal(db.released,1);assert.equal(db.calls.size,0);
});
test('reservation blocks same call identifier under different tenant',async()=>{
 const db=database();await reserveProofPilotCall(db.pool,{tenantId:'synthetic-a',callId:'shared',config});await assert.rejects(reserveProofPilotCall(db.pool,{tenantId:'synthetic-b',callId:'shared',config}),/call_tenant_conflict/);assert.equal(db.calls.get('shared').tenant_id,'synthetic-a');
});
test('single-writer restart controls retain 100 state records and 100 history records',async t=>{
 const d=await scratch(t),state=new JsonStateStore(path.join(d,'state.json')),history=new CallHistoryStore(path.join(d,'history.json'));
 for(let i=0;i<100;i++){await state.patchCall('s'+i,{tenantId:'synthetic-a'});await history.start('h'+i,{tenantId:'synthetic-a'});}
 const restartedState=new JsonStateStore(state.filePath);await restartedState.load();const restartedHistory=new CallHistoryStore(history.filePath);await restartedHistory.load();assert.equal(Object.keys(restartedState.state.calls).length,100);assert.equal(Object.keys(restartedHistory.data.calls).length,100);
});
