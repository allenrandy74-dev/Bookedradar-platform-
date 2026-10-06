import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pilotCriticalVoiceCalls, pilotSafetySnapshot, readProofPilotSnapshot, reserveProofPilotCall, preparePilotCall } from '../src/proof-pilot-admission.js';
import { proofPilotReadiness } from '../src/proof-pilot-control.js';
const now=Date.parse('2026-10-02T12:00:00Z');
const config={enabled:true,startAt:'2026-10-01T00:00:00Z',durationDays:14,maxCalls:25,customerApprovedScope:true,baselineDocumented:true,acceptancePassed:true,carrierFallbackAccepted:true,fallbackRejectStatusCode:486,fallbackAcceptanceReference:'synthetic-only'};
function database({calls=0,actions=[],voice=[],bookings=0,clock=now}={}) {
 const queries=[];
 const client={
  released:false,
  async query(sql,args=[]) {
   queries.push({sql,args});
   if(sql.includes('AS now_ms')) return {rows:[{now_ms:clock}]};
   if(sql.includes('SELECT tenant_id,payload')) return {rows:[]};
   if(sql.includes('SELECT count(*)::int AS n FROM bookedradar.voice_calls')) return {rows:[{n:calls}]};
   if(sql.includes('FROM bookedradar.recovery_actions')) return {rows:actions.map(payload=>({payload}))};
   if(sql.includes('SELECT call_id,payload')) return {rows:voice};
   if(sql.includes("payload->'bookingAttempt'")) return {rows:[{n:bookings}]};
   return {rows:[]};
  },
  release(){this.released=true;}
 };
 return {client,queries,connect:async()=>client,query:(...args)=>client.query(...args)};
}
test('status requires actual fallback acceptance and shared storage; nonpilot needs neither',async()=>{
 const forbidden={connect(){throw Error('unexpected DB read');}};
 assert.equal((await readProofPilotSnapshot(forbidden,{tenantId:'a',config:{}})).status.status,'NOT_A_PILOT');
 const blocked=await readProofPilotSnapshot(forbidden,{tenantId:'a',config:{...config,carrierFallbackAccepted:false,fallbackAcceptanceReference:''}});
 assert.equal(blocked.status.status,'BLOCKED');
 assert.ok(blocked.status.blockers.includes('carrier_fallback_acceptance_required'));
 assert.ok(blocked.status.blockers.includes('fallback_acceptance_reference_required'));
 assert.equal((await readProofPilotSnapshot(null,{tenantId:'a',config})).status.status,'BLOCKED');
 assert.ok(proofPilotReadiness({...config,stopOnCriticalFailure:false}).blockers.includes('stop_on_critical_failure_required'));
});
test('shared snapshot includes unresolved sends and exact window under tenant-only SQL',async()=>{
 const db=database({calls:4,actions:[{channel:'human_task',status:'reconciliation_required',failedAt:new Date(now).toISOString()}]});
 const result=await readProofPilotSnapshot(db,{tenantId:'tenant-a',config});
 assert.equal(result.status.status,'PAUSED');assert.equal(result.status.stopReason,'critical_failure');
 assert.equal(result.callsHandled,4);assert.equal(result.criticalActionFailures,1);
 const count=db.queries.find(q=>q.sql.includes('SELECT count(*)::int AS n FROM bookedradar.voice_calls'));
 assert.deepEqual(count.args,['tenant-a','2026-10-01T00:00:00.000Z','2026-10-15T00:00:00.000Z']);
 for(const q of db.queries.filter(q=>/FROM bookedradar\./.test(q.sql))) assert.equal(q.args[0],'tenant-a');
 assert.ok(db.queries[0].sql.includes('REPEATABLE READ READ ONLY'));assert.equal(db.client.released,true);
 assert.equal(db.queries.some(q=>/^(INSERT|UPDATE|DELETE)/.test(q.sql)),false);
});
test('critical voice evidence uses failure time, counts calls once, and treats unknown timing conservatively',()=>{
 const milestone={firstAt:now,lastAt:now,count:2};
 const rows=[
  {call_id:'failed',payload:{startedAt:0,milestones:{'transfer.failed':milestone,'lead.persist_failed':milestone}}},
  {call_id:'failed',payload:{milestones:{'greeting.failed':milestone}}},
  {call_id:'old',payload:{milestones:{'transfer.failed':{firstAt:1,lastAt:2}}}},
  {call_id:'future',payload:{milestones:{'transfer.failed':{firstAt:now+10000,lastAt:now+10000}}}},
  {call_id:'unknown',payload:{milestones:{'call.accept_failed':{count:1}}}},
  {call_id:'recovered-fallback',payload:{milestones:{'greeting.fallback':milestone}}},
 ];
 assert.equal(pilotCriticalVoiceCalls(rows,config,now),3);
});
test('persisted voice failure blocks the next reservation without a failed recovery action',async()=>{
 const db=database({voice:[{call_id:'old-call',payload:{milestones:{'transfer.failed':{firstAt:now,lastAt:now}}}}]});
 const result=await reserveProofPilotCall(db,{tenantId:'tenant-a',callId:'next-call',config});
 assert.equal(result.admitted,false);assert.equal(result.reason,'critical_failure');
 assert.equal(db.queries.some(q=>q.sql.startsWith('INSERT')),false);
});
test('unverified counts and database clocks fail closed and release read transaction',async()=>{
 for(const calls of [undefined,'0',-1,0.5]) {
  const db=database({calls:calls===undefined?null:calls});
  await assert.rejects(readProofPilotSnapshot(db,{tenantId:'a',config}),/pilot_call_count_unverified/);
  assert.ok(db.queries.some(q=>q.sql==='ROLLBACK'));assert.equal(db.client.released,true);
 }
 await assert.rejects(readProofPilotSnapshot(database({clock:'not-a-time'}),{tenantId:'a',config}),/pilot_clock_unverified/);
});
test('mandatory failure stop, manual pause, booking holds, cap and expiry remain enforced',async()=>{
 for(const [change,dbOptions,expected] of [
  [{manuallyPaused:true},{},'manual_pause'],[{}, {bookings:1},'booking_review_required'],
  [{},{calls:25},'call_cap_reached'],[{durationDays:1},{},'time_cap_reached'],
 ]) {
  const result=await pilotSafetySnapshot(database(dbOptions),{tenantId:'a',config:{...config,...change},now});
  assert.equal(result.status.stopReason,expected);
 }
});
test('known preaccept failures reject once, nonpilot behavior unchanged and provider attempts are outside fallback wrapper',async()=>{
 let rejects=0;
 const reject=async()=>{rejects++;};
 await assert.rejects(preparePilotCall({pilotEnabled:true,setup:async()=>{throw Error('setup_failure');},reject}),/setup_failure/);
 assert.equal(rejects,1);
 await assert.rejects(preparePilotCall({pilotEnabled:false,setup:async()=>{throw Error('setup_failure');},reject}),/setup_failure/);
 assert.equal(rejects,1);
 const args=await preparePilotCall({pilotEnabled:true,setup:async()=>({ok:true}),reject});
 assert.deepEqual(args,{ok:true});assert.equal(rejects,1);
});
const source=await fs.readFile(new URL('../server.js',import.meta.url),'utf8');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
async function incoming({stage,pilot=true}={}) {
 let accepts=0,rejects=0;
 const tenant={tenantId:'synthetic',commercial:{proofPilot:{...config,enabled:pilot}},policies:{}};
 const fail=step=>{if(stage===step)throw Error(step);};
 const deps={parseSipPhone:()=>'+14095550100',parseDialedNumber:()=>'+14095550101',registry:{resolveByPhone:()=>tenant},
  callHistory:{start:async()=>fail('history'),mark:async()=>{},finish:async()=>{}},maskPhone:x=>x,
  callLifecycle:{end(){}},console:{log(){},error(){}},rejectRealtimeCall:async()=>{rejects++;},OPENAI_API_KEY:'synthetic',
  enforceProofPilotAdmission:async()=>({handled:false}),postgresStores:{pool:{}},state:{patchCall:async()=>fail('state')},
  preparePilotCall,localBusinessContext:()=>({}),returningCallerContext:async()=>{fail('context');return {};},recoveryStore:{},
  buildOperatorInstructions:()=>'',operatorRulesForTenant:()=>({}),competitiveFeatureGuidance:()=>'',
  acceptRealtimeCall:async()=>{accepts++;fail('accept');},OPENAI_REALTIME_MODEL:'synthetic',OPENAI_VOICE:'synthetic',toolsForTenant:()=>{fail('tools');return [];},tools:[],inputTranscriptionForTenant:()=>{fail('transcription');return null;},
  recordCallMilestone(){},attachSideband:async()=>fail('sideband')};
 const marker='async function handleIncomingCall(event) {';
 const body=source.slice(source.indexOf(marker)+marker.length,source.indexOf('\nconst requireIngest')).trim().replace(/}\s*$/,'');
 const handler=new AsyncFunction('event',...Object.keys(deps),body);
 try{await handler({data:{call_id:'synthetic-call'}},...Object.values(deps));}catch{}
 return {accepts,rejects};
}
test('actual incoming handler rejects known pilot preparation failure but never retries ambiguous acceptance or sideband failure',async()=>{
 for(const stage of ['state','history','context','tools','transcription']) assert.deepEqual(await incoming({stage}),{accepts:0,rejects:1});
 for(const stage of ['accept','sideband']) assert.deepEqual(await incoming({stage}),{accepts:1,rejects:0});
 assert.deepEqual(await incoming(),{accepts:1,rejects:0});
 assert.deepEqual(await incoming({stage:'state',pilot:false}),{accepts:0,rejects:0});
});

test('pilot endpoint passes identical end bounds to reporting and reports skipped safety metrics as unknown',async()=>{
 const marker='routes.get("/api/v1/proof-pilot/status", requireAdmin, requireTenant, async (req, res) => {';
 const body=source.slice(source.indexOf(marker)+marker.length,source.indexOf('\n});',source.indexOf(marker)));
 let historyWindow,proofWindow;
 const deps={callHistory:{statsSince:async(...args)=>{historyWindow=args;return {callsHandled:3};}},
 radarProof:async(_store,_tenant,window)=>{proofWindow=window;return {};},recoveryStore:{failedActions:async()=>[]},
 readProofPilotSnapshot:async()=>({verified:false,status:{enabled:true,status:'BLOCKED',blockers:['synthetic']}}),
 postgresStores:{pool:{}},proofPilotStatus:()=>{},proofPilotScorecard:x=>x};
 const handler=new AsyncFunction('req','res',...Object.keys(deps),body);
 const res={json:x=>x,status(){return this;}};
 const result=await handler({bookedRadarTenant:{tenantId:'t1',commercial:{proofPilot:config}}},res,...Object.values(deps));
 assert.deepEqual(historyWindow,['t1',Date.parse(config.startAt),Date.parse('2026-10-15T00:00:00Z')]);
 assert.equal(proofWindow.untilMs,historyWindow[2]);assert.equal(result.scorecard.criticalFailures,null);
 assert.deepEqual(result.safety,{verified:false,criticalActionFailures:null,criticalVoiceFailures:null,unresolvedBookings:null});
});
