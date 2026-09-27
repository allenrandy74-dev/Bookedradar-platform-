import test from "node:test";
import assert from "node:assert/strict";
import { normalizeProofPilotConfig, proofPilotReadiness, proofPilotStatus, proofPilotScorecard } from "../src/proof-pilot-control.js";

const ready = {
  enabled:true, durationDays:14, maxCalls:25, coverageMode:"after_hours",
  startAt:"2026-09-27T12:00:00.000Z", customerApprovedScope:true,
  baselineDocumented:true, acceptancePassed:true, stopOnCriticalFailure:true
};

test("pilot rejects scope beyond the proof offer", () => {
  const p=normalizeProofPilotConfig({...ready,durationDays:15,maxCalls:26,coverageMode:"all_calls"});
  assert.equal(p.errors.length,3);
});
test("pilot cannot activate without customer approval, baseline and acceptance", () => {
  const r=proofPilotReadiness({enabled:true,startAt:"2026-09-27T12:00:00Z"});
  assert.equal(r.ready,false);
  assert.ok(r.blockers.includes("customer_scope_approval_required"));
  assert.ok(r.blockers.includes("acceptance_test_required"));
});
test("pilot completes at 25 calls", () => {
  const s=proofPilotStatus(ready,{now:Date.parse("2026-09-28T12:00:00Z"),callsHandled:25});
  assert.equal(s.status,"COMPLETE");
  assert.equal(s.stopReason,"call_cap_reached");
  assert.equal(s.callsRemaining,0);
});
test("pilot completes at time cap", () => {
  const s=proofPilotStatus(ready,{now:Date.parse("2026-10-12T12:00:00Z"),callsHandled:3});
  assert.equal(s.status,"COMPLETE");
  assert.equal(s.stopReason,"time_cap_reached");
});
test("critical failure pauses pilot", () => {
  const s=proofPilotStatus(ready,{now:Date.parse("2026-09-28T12:00:00Z"),criticalFailures:1});
  assert.equal(s.status,"PAUSED");
  assert.equal(s.stopReason,"critical_failure");
});
test("scorecard exposes incomplete and failed outcomes", () => {
  const s=proofPilotScorecard({status:"ACTIVE",callsHandled:10,incompleteCalls:2,criticalFailures:1,confirmedRevenue:500});
  assert.equal(s.intakeCompletionRate,.8);
  assert.equal(s.criticalFailures,1);
  assert.equal(s.confirmedRevenue,500);
});
