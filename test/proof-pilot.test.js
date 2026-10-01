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

test("optional business details are bounded and preserved in the actual follow-up task", async (t) => {
  let payload;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    payload = JSON.parse(options.body);
    return Response.json({ task: { id: "synthetic-task" } });
  });
  const result = normalizeProofPilotInquiry({
    name: "Synthetic", business: "Synthetic HVAC", email: "synthetic@example.com",
    serviceArea: "  Beaumont and nearby ZIP codes  ", businessHours: "Weekdays 8–5",
    services: "HVAC maintenance and repairs", currentWorkflow: "Voicemail after hours",
    website: "https://example.com", goal: "Respond to missed calls",
  });
  assert.equal(result.ok, true);
  await createWixFollowupTask({ apiKey: "synthetic-key", siteId: "synthetic-site", contactId: "synthetic-contact", lead: proofPilotLead(result.inquiry), retries: 0 });
  for (const value of ["Service area: Beaumont and nearby ZIP codes", "Business hours: Weekdays 8–5", "Main services: HVAC maintenance and repairs", "Voicemail after hours", "https://example.com", "Respond to missed calls"]) {
    assert.ok(payload.task.description.includes(value), value);
  }
  assert.doesNotMatch(payload.task.description, /Callback:/);
  const bounded = normalizeProofPilotInquiry({ ...result.inquiry, serviceArea: "a".repeat(501), businessHours: "b".repeat(501), services: "c".repeat(1201) });
  assert.equal(bounded.inquiry.serviceArea.length, 500);
  assert.equal(bounded.inquiry.businessHours.length, 500);
  assert.equal(bounded.inquiry.services.length, 1200);
});
