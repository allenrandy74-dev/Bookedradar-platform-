import test from 'node:test';
import assert from 'node:assert/strict';
import { enforceProofPilotAdmission, pilotFallbackReadiness, pilotCriticalFailures } from '../src/proof-pilot-admission.js';
import { proofPilotStatus } from '../src/proof-pilot-control.js';
const config = { enabled:true,startAt:'2026-09-29T00:00:00Z',durationDays:14,maxCalls:25,customerApprovedScope:true,baselineDocumented:true,acceptancePassed:true,carrierFallbackAccepted:true,fallbackRejectStatusCode:486,fallbackAcceptanceReference:'synthetic-test' };
test('fallback requires a recorded carrier acceptance and tested response code',()=>{
  assert.equal(pilotFallbackReadiness(config).ready,true);
  assert.equal(pilotFallbackReadiness({...config,carrierFallbackAccepted:false}).ready,false);
  assert.equal(pilotFallbackReadiness({...config,fallbackRejectStatusCode:603}).ready,false);
  assert.equal(pilotFallbackReadiness({...config,fallbackAcceptanceReference:''}).ready,false);
});
test('non-pilot traffic bypasses the admission gate without provider or database calls',async()=>{
  assert.deepEqual(await enforceProofPilotAdmission({tenant:{commercial:{}},pool:{connect(){throw Error('unexpected database call');}},reject(){throw Error('unexpected rejection');}}),{handled:false});
});
test('enabled pilot cannot proceed with local JSON storage and always releases local lifecycle',async()=>{
  const rejected=[],ended=[];
  const result=await enforceProofPilotAdmission({tenant:{tenantId:'tenant-a',commercial:{proofPilot:config}},callId:'call-a',reject:async args=>rejected.push(args),end:id=>ended.push(id)});
  assert.equal(result.handled,true);assert.equal(result.decision.reason,'pilot_requires_postgres');
  assert.deepEqual(rejected,[{callId:'call-a',statusCode:486}]);assert.deepEqual(ended,['call-a']);
});
test('database outage blocks pilot acceptance and rejection failures still release lifecycle',async()=>{
  const ended=[];
  await assert.rejects(enforceProofPilotAdmission({tenant:{tenantId:'a',commercial:{proofPilot:config}},callId:'x',pool:{connect:async()=>{throw Error('unavailable');}},reject:async()=>{throw Error('provider_down');},end:id=>ended.push(id)}),/provider_down/);
  assert.deepEqual(ended,['x']);
});
test('critical failures use failure time, exclude historical and future events, and retain unknown-time failures',()=>{
  const at=Date.parse('2026-09-30T00:00:00Z');
  const actions=[{channel:'human_alert',createdAt:'2026-01-01T00:00:00Z'},
    {channel:'human_alert',createdAt:'2026-01-01T00:00:00Z',failedAt:'2026-09-29T12:00:00Z'},
    {channel:'sms',lastError:'transfer failed',failedAt:'2026-10-01T12:00:00Z'},
    {channel:'human_alert',status:'dispatching',claimExpiresAt:'2026-10-01T00:00:00Z',dispatchStartedAt:'2026-09-29T12:00:00Z'},
    {channel:'email',failedAt:'2026-09-29T12:00:00Z'}, {channel:'human_task'}];
  assert.equal(pilotCriticalFailures(actions,config,at),2);
});
test('manual pause in tenant configuration is reflected by the status API rules',()=>{
  assert.equal(proofPilotStatus({...config,manuallyPaused:true},{now:Date.parse('2026-09-30T00:00:00Z')}).stopReason,'manual_pause');
});
