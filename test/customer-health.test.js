import test from "node:test";
import assert from "node:assert/strict";
import { assessCustomerHealth } from "../src/customer-health.js";

test("customer health returns no_data instead of a false healthy status", () => {
  assert.deepEqual(assessCustomerHealth(), {
    status: "no_data",
    signals: [],
    evidenceLevel: "insufficient",
  });
});

test("customer health is healthy only with operating evidence and no signals", () => {
  const result = assessCustomerHealth({ recentCalls: 12, opportunitiesCaptured: 4 });
  assert.equal(result.status, "healthy");
  assert.equal(result.evidenceLevel, "operating");
  assert.deepEqual(result.signals, []);
});

test("customer health watch status is explainable", () => {
  const result = assessCustomerHealth({
    recentCalls: 10,
    voiceAssessment: { status: "attention", signals: [{ code: "realtime_error" }] },
    totalFailedActions: 2,
    criticalFailedActions: 0,
    crmSyncFailures: 1,
    unresolvedKnowledgeGaps: 2,
  });
  assert.equal(result.status, "watch");
  assert.deepEqual(result.signals.map(x => x.code), [
    "voice_health_attention",
    "recovery_action_failure",
    "crm_sync_failure",
    "unresolved_knowledge_gaps",
  ]);
});

test("customer health marks material readiness, voice, and critical-action failures at risk", () => {
  const result = assessCustomerHealth({
    readinessBlockers: 2,
    voiceAssessment: {
      status: "critical",
      signals: [{ code: "greeting_failure" }, { code: "transfer_failure" }],
    },
    totalFailedActions: 3,
    criticalFailedActions: 1,
    recentCalls: 8,
  });
  assert.equal(result.status, "at_risk");
  assert.equal(result.evidenceLevel, "operating");
  assert.deepEqual(result.signals.map(x => x.code), [
    "readiness_blocker",
    "voice_health_critical",
    "critical_action_failure",
    "recovery_action_failure",
  ]);
});

test("customer health keeps reliability risk visible even before traffic exists", () => {
  const result = assessCustomerHealth({
    voiceAssessment: { status: "critical", signals: [{ code: "call_accept_failure" }] },
  });
  assert.equal(result.status, "at_risk");
  assert.equal(result.evidenceLevel, "limited");
});
