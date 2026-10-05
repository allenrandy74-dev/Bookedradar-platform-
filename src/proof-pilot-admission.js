import { useJsonMemoryView } from "./json-file-transaction.js";
import { CallHistoryStore } from './call-history.js';
import { proofPilotReadiness, proofPilotStatus } from './proof-pilot-control.js';

export function pilotFallbackReadiness(config = {}) {
  if (config.enabled !== true) return { ready: true, blockers: [] };
  const blockers = [];
  if (config.carrierFallbackAccepted !== true) blockers.push('carrier_fallback_acceptance_required');
  if (![486, 503].includes(config.fallbackRejectStatusCode)) blockers.push('tested_fallback_reject_code_required');
  if (!String(config.fallbackAcceptanceReference || '').trim()) blockers.push('fallback_acceptance_reference_required');
  return { ready: blockers.length === 0, blockers };
}

export function pilotCriticalFailures(actions, config, now = Date.now()) {
  const start = Date.parse(config?.startAt || '');
  const end = start + Number(config?.durationDays ?? 14) * 86400000;
  return actions.filter(action => {
    if (action.status === "dispatching" && Date.parse(action.claimExpiresAt || "") > now) return false;
    if (!['human_alert', 'human_task'].includes(String(action.channel || '')) && !String(action.lastError || '').toLowerCase().includes('transfer')) return false;
    const at = Date.parse(action.failedAt || action.dispatchStartedAt || action.completedAt || action.createdAt || '');
    // A critical failure with unknown timing cannot safely be dismissed.
    return !Number.isFinite(at) || (at >= start && at < end && at <= now);
  }).length;
}

export async function pilotBookingHolds(database, tenantId) {
  if (typeof tenantId !== 'string' || !tenantId.trim()) throw new Error('pilot_tenant_required');
  // A hold is unresolved regardless of its age. Pending may still be in flight;
  // conservatively pause new admission until a verified receipt is persisted.
  const { rows } = await database.query(`SELECT count(*)::int AS n FROM bookedradar.call_control_state
    WHERE tenant_id=$1 AND payload->'bookingAttempt'->>'status' IN ('pending','uncertain')`, [tenantId]);
  const n = rows[0]?.n;
  if (!Number.isInteger(n) || n < 0) throw new Error('pilot_booking_hold_count_unverified');
  return n;
}

const CRITICAL_VOICE_MILESTONES = [
  'call.accept_failed', 'lead.persist_failed', 'transfer.failed',
  'greeting.failed', 'greeting.fallback',
];

// Count calls, not milestone repeats. A fallback is a conservative review signal,
// not proof that the caller was lost or that a human answered.
export function pilotCriticalVoiceCalls(calls, config, now = Date.now()) {
  const start = Date.parse(config?.startAt || '');
  const end = start + Number(config?.durationDays ?? 14) * 86400000;
  const failed = new Set();
  for (const { call_id: callId, payload: call } of calls) {
    const critical = CRITICAL_VOICE_MILESTONES.some(key => {
      const milestone = call?.milestones?.[key];
      if (!milestone) return false;
      const first = Number(milestone.firstAt);
      const last = Number(milestone.lastAt);
      if (!Number.isFinite(first) || first <= 0 || !Number.isFinite(last) || last <= 0) return true;
      return [first, last].some(at => at >= start && at < end && at <= now);
    });
    if (critical) failed.add(callId);
  }
  return failed.size;
}

function admissionReadiness(config) {
  const scope = proofPilotReadiness(config);
  const fallback = pilotFallbackReadiness(config);
  return { ...scope, ready: scope.ready && fallback.ready, blockers: [...scope.blockers, ...fallback.blockers] };
}

// The same queries and DB time drive runtime admission and the private status API.
// The caller owns the transaction; reads never create, retry or release work.
export async function pilotSafetySnapshot(database, { tenantId, config, now }) {
  const readiness = admissionReadiness(config);
  if (!readiness.enabled) return { verified: false, status: { enabled: false, status: 'NOT_A_PILOT' } };
  if (!readiness.ready) return { verified: false, status: { enabled: true, status: 'BLOCKED', blockers: readiness.blockers } };
  if (typeof tenantId !== 'string' || !tenantId.trim()) throw new Error('pilot_tenant_required');
  if (!Number.isFinite(now)) throw new Error('pilot_clock_unverified');
  const startAt = new Date(Date.parse(readiness.pilot.startAt)).toISOString();
  const endAt = new Date(Date.parse(startAt) + readiness.pilot.durationDays * 86400000).toISOString();
  const countResult = await database.query(`SELECT count(*)::int AS n FROM bookedradar.voice_calls
    WHERE tenant_id=$1 AND started_at >= $2::timestamptz AND started_at < $3::timestamptz`, [tenantId, startAt, endAt]);
  const callsHandled = countResult.rows[0]?.n;
  if (!Number.isInteger(callsHandled) || callsHandled < 0) throw new Error('pilot_call_count_unverified');
  const actionResult = await database.query(`SELECT payload || jsonb_build_object('status',status) AS payload
    FROM bookedradar.recovery_actions WHERE tenant_id=$1 AND
    (status IN ('failed','reconciliation_required') OR
      (status='dispatching' AND (claim_expires_at IS NULL OR claim_expires_at <= clock_timestamp())))`, [tenantId]);
  const voiceResult = await database.query(`SELECT call_id,payload FROM bookedradar.voice_calls
    WHERE tenant_id=$1 AND (payload->'milestones') ?| $2::text[]`, [tenantId, CRITICAL_VOICE_MILESTONES]);
  const criticalActionFailures = pilotCriticalFailures(actionResult.rows.map(row => row.payload), config, now);
  const criticalVoiceFailures = pilotCriticalVoiceCalls(voiceResult.rows, config, now);
  const criticalFailures = criticalActionFailures + criticalVoiceFailures;
  const unresolvedBookings = await pilotBookingHolds(database, tenantId);
  const status = proofPilotStatus(config, { now, callsHandled, criticalFailures, unresolvedBookings });
  return { verified: true, status, callsHandled, criticalFailures, criticalActionFailures, criticalVoiceFailures, unresolvedBookings };
}

export async function readProofPilotSnapshot(pool, { tenantId, config }) {
  const readiness = admissionReadiness(config);
  if (!readiness.enabled || !readiness.ready) return pilotSafetySnapshot(null, { tenantId, config });
  if (!pool) return { verified: false, status: { enabled: true, status: 'BLOCKED', blockers: ['shared_postgres_required'] } };
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='15s'");
    const now = Number((await client.query('SELECT extract(epoch FROM clock_timestamp()) * 1000 AS now_ms')).rows[0]?.now_ms);
    const snapshot = await pilotSafetySnapshot(client, { tenantId, config, now });
    await client.query('COMMIT');
    return snapshot;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

// Reject only a known setup failure before an acceptance request is attempted.
// Provider acceptance itself stays outside this wrapper: timeout there is ambiguous.
export async function preparePilotCall({ pilotEnabled, setup, reject }) {
  try { return await setup(); }
  catch (error) {
    if (pilotEnabled) await reject();
    throw error;
  }
}

// Every app instance reserves under the same tenant lock. The existing durable
// call-history row is the reservation; a crash or acceptance failure consumes
// a slot conservatively, rather than allowing more than the approved maximum.
export async function reserveProofPilotCall(pool, { tenantId, callId, config, callerMasked = '', dialedMasked = '' }) {
  if (!tenantId || !callId) throw new Error('pilot_call_identity_required');
  const readiness = admissionReadiness(config);
  if (!readiness.enabled || !readiness.ready) {
    return { admitted: false, reason: 'pilot_not_ready' };
  }
  const startAt = new Date(Date.parse(readiness.pilot.startAt)).toISOString();
  const endAt = new Date(Date.parse(startAt) + readiness.pilot.durationDays * 86400000).toISOString();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='15s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`bookedradar_pilot:${tenantId}`]);
    const now = Number((await client.query('SELECT extract(epoch FROM clock_timestamp()) * 1000 AS now_ms')).rows[0].now_ms);
    const existing = (await client.query('SELECT tenant_id,payload FROM bookedradar.voice_calls WHERE call_id=$1', [callId])).rows[0];
    if (existing && existing.tenant_id !== tenantId) throw new Error('call_tenant_conflict');
    const snapshot = await pilotSafetySnapshot(client, { tenantId, config, now });
    const status = snapshot.status;
    // A replay never creates another reservation or repeats a provider decision.
    if (existing) {
      await client.query('COMMIT');
      return { admitted: false, duplicate: true, reason: 'call_already_recorded', status };
    }
    if (status.status !== 'ACTIVE') {
      await client.query('COMMIT');
      return { admitted: false, reason: status.stopReason || status.status.toLowerCase(), status };
    }
    const history = useJsonMemoryView(new CallHistoryStore('/unused/pilot-reservation.json'));
    history.loaded = true;
    history.persist = async () => {};
    const call = await history.start(callId, { tenantId, callerMasked, dialedMasked });
    call.startedAt = now;
    call.updatedAt = now;
    call.pilotAdmission = { startAt, admittedAt: new Date(now).toISOString(), maxCalls: readiness.pilot.maxCalls };
    await client.query(`INSERT INTO bookedradar.voice_calls (call_id,tenant_id,caller_masked,dialed_masked,started_at,updated_at,payload)
      VALUES ($1,$2,$3,$4,$5,$5,$6::jsonb)`, [callId, tenantId, call.callerMasked, call.dialedMasked, new Date(now).toISOString(), JSON.stringify(call)]);
    await client.query('COMMIT');
    return { admitted: true, status, callsReserved: snapshot.callsHandled + 1 };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

export async function enforceProofPilotAdmission({ tenant, callId, pool, reject, end, log = () => {}, callerMasked, dialedMasked }) {
  const config = tenant?.commercial?.proofPilot || {};
  if (config.enabled !== true) return { handled: false };
  let decision;
  try {
    decision = pool
      ? await reserveProofPilotCall(pool, { tenantId: tenant.tenantId, callId, config, callerMasked, dialedMasked })
      : { admitted: false, reason: 'pilot_requires_postgres' };
  } catch {
    decision = { admitted: false, reason: 'pilot_admission_unavailable' };
  }
  if (decision.admitted) return { handled: false, decision };
  log({ event: 'pilot.admission_blocked', tenantId: tenant.tenantId, callId, reason: decision.reason });
  try {
    if (!decision.duplicate) await reject({ callId, statusCode: [486, 503].includes(config.fallbackRejectStatusCode) ? config.fallbackRejectStatusCode : 503 });
  } finally { end(callId); }
  return { handled: true, decision };
}
