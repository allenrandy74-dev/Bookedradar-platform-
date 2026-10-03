const DAY_MS = 24 * 60 * 60 * 1000;

function clean(value, max = 300) {
  return String(value ?? "").trim().slice(0, max);
}

export function normalizeProofPilotConfig(input = {}) {
  if (!input || input.enabled !== true) return { enabled: false };
  const durationDays = Number(input.durationDays ?? 14);
  const maxCalls = Number(input.maxCalls ?? 25);
  const coverageMode = clean(input.coverageMode || "after_hours", 40).toLowerCase();
  const allowedModes = new Set(["after_hours", "overflow"]);
  const startAt = clean(input.startAt, 60);
  const customerApprovedScope = input.customerApprovedScope === true;
  const baselineDocumented = input.baselineDocumented === true;
  const acceptancePassed = input.acceptancePassed === true;
  const stopOnCriticalFailure = input.stopOnCriticalFailure !== false;

  const errors = [];
  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 14) errors.push("duration_days_must_be_1_to_14");
  if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 25) errors.push("max_calls_must_be_1_to_25");
  if (!allowedModes.has(coverageMode)) errors.push("coverage_mode_must_be_after_hours_or_overflow");
  if (startAt && !Number.isFinite(Date.parse(startAt))) errors.push("invalid_start_at");

  return {
    enabled: true,
    durationDays,
    maxCalls,
    coverageMode,
    startAt,
    customerApprovedScope,
    baselineDocumented,
    acceptancePassed,
    stopOnCriticalFailure,
    errors,
  };
}

export function proofPilotReadiness(input = {}) {
  const pilot = normalizeProofPilotConfig(input);
  if (!pilot.enabled) return { enabled: false, ready: true, blockers: [] };
  const blockers = [...pilot.errors];
  if (!pilot.customerApprovedScope) blockers.push("customer_scope_approval_required");
  if (!pilot.baselineDocumented) blockers.push("baseline_workflow_required");
  if (!pilot.acceptancePassed) blockers.push("acceptance_test_required");
  if (!pilot.stopOnCriticalFailure) blockers.push("stop_on_critical_failure_required");
  if (!pilot.startAt) blockers.push("pilot_start_time_required");
  return { enabled: true, ready: blockers.length === 0, blockers, pilot };
}

export function proofPilotStatus(input = {}, {
  now = Date.now(),
  callsHandled = 0,
  criticalFailures = 0,
  unresolvedBookings = 0,
  manuallyPaused = input?.manuallyPaused === true,
  firstValueAt = "",
} = {}) {
  const readiness = proofPilotReadiness(input);
  if (!readiness.enabled) return { enabled: false, status: "NOT_A_PILOT" };
  const pilot = readiness.pilot;
  if (!readiness.ready) return { enabled: true, status: "BLOCKED", blockers: readiness.blockers };

  const startMs = Date.parse(pilot.startAt);
  const endMs = startMs + pilot.durationDays * DAY_MS;
  const callsRemaining = Math.max(0, pilot.maxCalls - Number(callsHandled || 0));
  const timeRemainingMs = Math.max(0, endMs - now);

  let status = "ACTIVE";
  let stopReason = "";
  if (manuallyPaused) {
    status = "PAUSED";
    stopReason = "manual_pause";
  } else if (Number(unresolvedBookings || 0) > 0) {
    status = "PAUSED";
    stopReason = "booking_review_required";
  } else if (pilot.stopOnCriticalFailure && Number(criticalFailures || 0) > 0) {
    status = "PAUSED";
    stopReason = "critical_failure";
  } else if (Number(callsHandled || 0) >= pilot.maxCalls) {
    status = "COMPLETE";
    stopReason = "call_cap_reached";
  } else if (now >= endMs) {
    status = "COMPLETE";
    stopReason = "time_cap_reached";
  } else if (now < startMs) {
    status = "SCHEDULED";
  }

  return {
    enabled: true,
    status,
    stopReason,
    startAt: new Date(startMs).toISOString(),
    endAt: new Date(endMs).toISOString(),
    durationDays: pilot.durationDays,
    maxCalls: pilot.maxCalls,
    callsHandled: Number(callsHandled || 0),
    unresolvedBookings: Number(unresolvedBookings || 0),
    callsRemaining,
    timeRemainingMs,
    firstValueAt: clean(firstValueAt, 60) || null,
    coverageMode: pilot.coverageMode,
    customerApprovedScope: pilot.customerApprovedScope,
    baselineDocumented: pilot.baselineDocumented,
    acceptancePassed: pilot.acceptancePassed,
  };
}

export function proofPilotScorecard({
  status,
  callsHandled = 0,
  qualifiedOpportunities = 0,
  humanTransfers = 0,
  incompleteCalls = 0,
  recoveredOpportunities = 0,
  confirmedRevenue = 0,
  criticalFailures = 0,
  unresolvedBookings = 0,
  firstValueAt = null,
} = {}) {
  const handled = Number(callsHandled || 0);
  return {
    status: status || "UNKNOWN",
    callsHandled: handled,
    qualifiedOpportunities: Number(qualifiedOpportunities || 0),
    humanTransfers: Number(humanTransfers || 0),
    incompleteCalls: Number(incompleteCalls || 0),
    recoveredOpportunities: Number(recoveredOpportunities || 0),
    confirmedRevenue: confirmedRevenue === null ? null : Number(confirmedRevenue || 0),
    criticalFailures: Number(criticalFailures || 0),
    unresolvedBookings: Number(unresolvedBookings || 0),
    firstValueAt: firstValueAt || null,
    intakeCompletionRate: handled ? Math.max(0, (handled - Number(incompleteCalls || 0)) / handled) : 0,
    disclaimer: "Confirmed revenue is shown only when supplied by a trusted source or authorized user. Pilot results include incomplete and failed outcomes; synthetic/demo activity must be excluded.",
  };
}
