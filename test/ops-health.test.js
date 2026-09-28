import test from "node:test";
import assert from "node:assert/strict";
import { assessVoiceHealth } from "../src/ops-health.js";

test("voice health reports no_data with no calls", () => {
  assert.deepEqual(assessVoiceHealth({ callsStarted: 0 }), {
    status: "no_data",
    severity: "none",
    signals: [],
  });
});

test("voice health reports healthy when no defect signals exist", () => {
  const result = assessVoiceHealth({
    callsStarted: 10,
    callsAccepted: 10,
    callsEndedWithoutFirstAudio: 0,
    greetingFailures: 0,
    realtimeErrors: 0,
    transferRequests: 3,
    transfersInitiated: 3,
  });
  assert.equal(result.status, "healthy");
  assert.deepEqual(result.signals, []);
});

test("voice health treats silent/greeting failures as critical", () => {
  const result = assessVoiceHealth({
    callsStarted: 5,
    callsAccepted: 5,
    callsEndedWithoutFirstAudio: 1,
    greetingFailures: 1,
    realtimeErrors: 0,
    transferRequests: 0,
    transfersInitiated: 0,
  });
  assert.equal(result.status, "critical");
  assert.equal(result.severity, "critical");
  assert.deepEqual(result.signals.map(x => x.code), [
    "ended_without_first_audio",
    "greeting_failure",
  ]);
});

test("voice health surfaces Realtime, accept, and transfer gaps without overstating severity", () => {
  const result = assessVoiceHealth({
    callsStarted: 8,
    callsAccepted: 7,
    callsEndedWithoutFirstAudio: 0,
    greetingFailures: 0,
    realtimeErrors: 2,
    transferRequests: 4,
    transfersInitiated: 3,
  });
  assert.equal(result.status, "attention");
  assert.equal(result.severity, "warning");
  assert.deepEqual(result.signals.map(x => x.code), [
    "realtime_error",
    "call_accept_gap",
    "transfer_not_initiated",
  ]);
});

test("voice health escalates explicit accept, persistence, and transfer failures", () => {
  const result = assessVoiceHealth({
    callsStarted: 6,
    callsAccepted: 5,
    callsEndedWithoutFirstAudio: 0,
    greetingFailures: 0,
    realtimeErrors: 0,
    sidebandErrors: 1,
    acceptFailures: 1,
    leadPersistFailures: 1,
    crmSyncFailures: 1,
    unroutedCalls: 1,
    transferRequests: 2,
    transfersInitiated: 1,
    transferFailures: 1,
  });
  assert.equal(result.status, "critical");
  assert.deepEqual(result.signals.map(x => x.code), [
    "call_accept_failure",
    "lead_persistence_failure",
    "transfer_failure",
    "sideband_error",
    "crm_sync_failure",
    "unrouted_call",
    "call_accept_gap",
    "transfer_not_initiated",
  ]);
});
