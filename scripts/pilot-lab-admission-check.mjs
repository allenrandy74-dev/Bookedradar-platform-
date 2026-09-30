import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { reserveProofPilotCall, enforceProofPilotAdmission } from '../src/proof-pilot-admission.js';

// Database-only rehearsal. Never calls a provider or changes existing tenants.
const expectedHost = process.argv.find(arg => arg.startsWith('--expected-host='))?.slice(16);
const env = process.env;
const host = new URL(env.DATABASE_URL || '').hostname;
assert.ok(expectedHost && host === expectedHost, 'explicit_lab_host_mismatch');
assert.equal(env.PRIVATE_VOICE_LAB_DATABASE_HOST, expectedHost, 'configured_lab_host_mismatch');
assert.equal(env.PRIVATE_VOICE_LAB, 'true', 'private_lab_required');
for (const key of ['VOICE_ENABLED', 'DISPATCH_ENABLED', 'BOOKEDRADAR_BILLING_ENABLED', 'OPS_ALERTS_ENABLED']) {
  assert.equal(env[key], 'false', `${key}_must_be_disabled`);
}
const id = randomUUID();
const tenantId = `synthetic-pilot-rehearsal-${id}`;
const callIds = Array.from({length: 50}, (_, i) => `pilot-rehearsal-${id}-${i}`);
const pool = new Pool({connectionString: env.DATABASE_URL, max: 10, connectionTimeoutMillis: 5000, statement_timeout: 15000});
const config = {
  enabled: true, startAt: new Date(Date.now() - 3600000).toISOString(), durationDays: 14, maxCalls: 25,
  customerApprovedScope: true, baselineDocumented: true, acceptancePassed: true,
  carrierFallbackAccepted: true, fallbackRejectStatusCode: 486,
  fallbackAcceptanceReference: 'database-only-synthetic-fixture-not-carrier-acceptance',
};
const tenant = {tenantId, commercial: {proofPilot: config}};
const counts = async () => Number((await pool.query('SELECT count(*)::int AS n FROM bookedradar.voice_calls WHERE tenant_id=$1', [tenantId])).rows[0].n);
let result;
try {
  assert.equal(await counts(), 0, 'fixture_namespace_not_empty');
  const decisions = await Promise.allSettled(callIds.map(callId => reserveProofPilotCall(pool, {tenantId, callId, config})));
  assert.equal(decisions.filter(r => r.status === 'rejected').length, 0);
  const values = decisions.map(r => r.value);
  assert.equal(values.filter(r => r.admitted).length, 25);
  assert.equal(values.filter(r => r.reason === 'call_cap_reached').length, 25);
  assert.equal(await counts(), 25);
  const admittedId = callIds[values.findIndex(r => r.admitted)];
  assert.equal((await reserveProofPilotCall(pool, {tenantId, callId: admittedId, config})).duplicate, true);
  let rejected = 0, ended = 0;
  const cap = await enforceProofPilotAdmission({tenant, callId: `pilot-rehearsal-${id}-blocked`, pool,
    reject: async ({statusCode}) => { assert.equal(statusCode, 486); rejected++; }, end: () => { ended++; }});
  assert.equal(cap.decision.reason, 'call_cap_reached');
  assert.equal(cap.handled, true);
  assert.equal(rejected, 1); assert.equal(ended, 1);
  for (const [name, overrides, reason] of [
    ['paused', {manuallyPaused: true}, 'manual_pause'],
    ['expired', {startAt: new Date(Date.now()-15*86400000).toISOString()}, 'time_cap_reached'],
    ['scheduled', {startAt: new Date(Date.now()+86400000).toISOString()}, 'scheduled'],
    ['unaccepted', {carrierFallbackAccepted: false}, 'pilot_not_ready'],
  ]) {
    const decision = await reserveProofPilotCall(pool, {tenantId, callId: `pilot-rehearsal-${id}-${name}`, config: {...config, ...overrides}});
    assert.equal(decision.reason, reason);
  }
  assert.equal(await counts(), 25);
  result = {event: 'pilot.lab_admission_rehearsal', at: new Date().toISOString(), ok: true,
    attempts: 50, admitted: 25, capped: 25, replayVerified: true, gateRejectAndEndVerified: true,
    pausedExpiredScheduledAndUnacceptedVerified: true, providerCalls: 0, schemaChanges: 0};
} finally {
  // Only this run's exact synthetic namespace AND generated call IDs are eligible.
  try {
    await pool.query('DELETE FROM bookedradar.voice_calls WHERE tenant_id=$1 AND call_id=ANY($2::text[])', [tenantId, callIds]);
    assert.equal(await counts(), 0, 'synthetic_cleanup_incomplete');
    if (result) console.log(JSON.stringify({...result, syntheticRowsRemaining: 0}));
  } finally { await pool.end(); }
}
