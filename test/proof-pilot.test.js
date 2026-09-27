import test from "node:test";
import assert from "node:assert/strict";
import { normalizeProofPilotInquiry, proofPilotLead } from "../src/proof-pilot.js";

test("proof pilot inquiry requires business context and contact", () => {
  assert.equal(normalizeProofPilotInquiry({ name:"A", business:"B", trade:"HVAC" }).ok, false);
});
test("proof pilot inquiry rejects honeypot submissions", () => {
  assert.equal(normalizeProofPilotInquiry({ name:"A", business:"B", trade:"HVAC", email:"a@b.com", company_url:"spam" }).ok, false);
});
test("proof pilot inquiry becomes CRM-ready lead", () => {
  const result=normalizeProofPilotInquiry({ name:"Jane Doe", business:"Jane HVAC", trade:"HVAC", email:"jane@example.com", currentWorkflow:"Owner answers after hours" });
  assert.equal(result.ok,true);
  const lead=proofPilotLead(result.inquiry);
  assert.match(lead.service_type,/Proof Pilot/);
  assert.match(lead.notes,/Owner answers/);
});
