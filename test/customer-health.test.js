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

test('unresolved customer sends require review even with no failed actions',()=>{
  const result=assessCustomerHealth({recentCalls:3,totalUnresolvedActions:1});
  assert.equal(result.status,'watch');assert.equal(result.signals[0].code,'recovery_action_unresolved');
  const critical=assessCustomerHealth({criticalUnresolvedActions:1,totalUnresolvedActions:2});
  assert.equal(critical.status,'at_risk');assert.equal(critical.evidenceLevel,'limited');
});

test('recovery review is tenant-bound and separates active sends from durable holds',async()=>{
  const {recoveryActionHealth}=await import('../src/customer-health.js');
  const now=new Date('2026-10-01T12:00:00Z');
  const actions=[
    {tenantId:'a',status:'dispatching',channel:'human_task',claimExpiresAt:'2026-10-01T12:01:00Z'},
    {tenantId:'a',status:'dispatching',channel:'human_task',claimExpiresAt:'2026-10-01T12:00:00Z',dispatchStartedAt:'2026-09-01T00:00:00Z'},
    {tenantId:'a',status:'dispatching',channel:'email',claimExpiresAt:'invalid'},
    {tenantId:'a',status:'reconciliation_required',channel:'sms',createdAt:'2026-10-01T10:00:00Z'},
    {tenantId:'b',status:'reconciliation_required',channel:'human_alert'},
    {tenantId:'a',status:'completed',channel:'human_alert'},
    {tenantId:'a',status:'processing',channel:'human_alert'},
  ];
  const before=structuredClone(actions);
  assert.deepEqual(recoveryActionHealth(actions,'a',{now}),{totalUnresolvedActions:3,criticalUnresolvedActions:1,activeDispatches:1,oldestUnresolvedAt:'2026-09-01T00:00:00.000Z'});
  assert.deepEqual(actions,before);assert.throws(()=>recoveryActionHealth(actions,''),/known_tenant_required/);
  assert.equal(recoveryActionHealth([{tenantId:'a',status:'reconciliation_required'}],'a',{now}).oldestUnresolvedAt,null);
});
