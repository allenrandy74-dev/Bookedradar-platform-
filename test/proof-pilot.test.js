import test from "node:test";
import assert from "node:assert/strict";
import { normalizeProofPilotInquiry, proofPilotLead, proofPilotInquiryKey } from "../src/proof-pilot.js";
import { createWixFollowupTask } from "../src/wix.js";

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

test("proof pilot idempotency key is stable and does not expose contact data", () => {
  const inquiry={business:"Jane HVAC",email:"Jane@Example.com",phone:"409-555-1212"};
  const a=proofPilotInquiryKey(inquiry);
  const b=proofPilotInquiryKey({...inquiry,email:"jane@example.com"});
  assert.equal(a,b);
  assert.equal(a.includes("example.com"),false);
  assert.equal(a.includes("4095551212"),false);
});

test("three-field signup defaults to email-only with trade deferred", () => {
  const result = normalizeProofPilotInquiry({ name: "Jane", business: "Jane HVAC", email: "Jane@Example.com" });
  assert.equal(result.ok, true);
  assert.equal(result.inquiry.contactPreference, "email");
  assert.equal(result.inquiry.trade, "Not specified");
  assert.equal(result.inquiry.email, "jane@example.com");
});

test("email-only preference suppresses a callback even if a phone was provided", () => {
  const result = normalizeProofPilotInquiry({ name: "Jane", business: "Jane HVAC", email: "jane@example.com", phone: "+14095550100", contactPreference: "email" });
  const lead = proofPilotLead(result.inquiry);
  assert.equal(lead.callback_number, "");
  assert.match(lead.notes, /EMAIL ONLY.*do not make a sales call/);
});

test("chosen channel requires matching contact information", () => {
  const base = { name: "Jane", business: "Jane HVAC" };
  assert.equal(normalizeProofPilotInquiry({ ...base, email: "jane@example.com", contactPreference: "phone" }).error, "phone_required_for_phone_followup");
  assert.equal(normalizeProofPilotInquiry({ ...base, phone: "+14095550100", contactPreference: "email" }).error, "email_required_for_email_followup");
  assert.equal(normalizeProofPilotInquiry({ ...base, email: "jane@example.com", contactPreference: "sms" }).error, "invalid_contact_preference");
});

test("legacy phone-only inquiries still become callback leads", () => {
  const result = normalizeProofPilotInquiry({ name: "Jane", business: "Jane HVAC", phone: "+14095550100" });
  assert.equal(result.ok, true);
  assert.equal(result.inquiry.contactPreference, "phone");
  assert.equal(proofPilotLead(result.inquiry).callback_number, "+14095550100");
});

test("email-only signup carries its preference through the actual Wix task payload", async (t) => {
  let payload;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    payload = JSON.parse(options.body);
    return Response.json({ task: { id: "synthetic-task" } });
  });
  const result = normalizeProofPilotInquiry({ name: "Jane", business: "Jane HVAC", email: "jane@example.com", contactPreference: "email" });
  await createWixFollowupTask({ apiKey: "synthetic-key", siteId: "synthetic-site", contactId: "synthetic-contact", lead: proofPilotLead(result.inquiry), retries: 0 });
  assert.match(payload.task.description, /EMAIL ONLY.*do not make a sales call/);
  assert.match(payload.task.description, /jane@example.com/);
  assert.doesNotMatch(payload.task.description, /Callback:/);
});
