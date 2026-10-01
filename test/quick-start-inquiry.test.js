import test from "node:test";
import assert from "node:assert/strict";
import { normalizeProofPilotInquiry, proofPilotLead, proofPilotTaskLead, proofPilotInquiryKey } from "../src/proof-pilot.js";
import { prepareOnboardingFromWixSubmission } from "../src/onboarding/prepare.js";
import { createWixInquiryNotes, createWixFollowupTask } from "../src/wix.js";

const answers = {
  first_name: "Synthetic", business_name: "QA HVAC", email: "qa@example.com",
  contact_preference: "email", phone: "+14095550199", business_type: "HVAC",
  service_area: "Beaumont", business_hours: "Weekdays 8–5", services: "Repair",
  coverage: "After hours", urgent_contact: "Operator 409-555-0100",
  urgent_definition: "No cooling", customer_tracking: "A spreadsheet", booking: "Sometimes",
  anything_else: "Synthetic test only — do not contact",
};
const parse = setupAnswers => normalizeProofPilotInquiry({ inquiryType: "setup", setupAnswers });

test("complete setup keeps the transfer destination separate from email-only follow-up", () => {
  const result = parse(answers);
  assert.equal(result.ok, true);
  assert.equal(normalizeProofPilotInquiry({ inquiryType: " setup ", setupAnswers: answers }).ok, true);
  assert.equal(result.inquiry.phone, "");
  assert.equal(proofPilotLead(result.inquiry).callback_number, "");
  const preparation = prepareOnboardingFromWixSubmission({ submissions: result.inquiry.setupAnswers }, { env: {} });
  assert.equal(preparation.activationAllowed, false);
  assert.match(proofPilotLead(result.inquiry).notes, /urgent_contact: Operator 409-555-0100/);
  assert.match(proofPilotLead(result.inquiry).notes, /not permission for sales calls/);
});

test("setup validates required answers, direct transfer number, choices, and lengths without truncation", () => {
  for (const field of ["first_name", "business_name", "email", "business_type", "service_area", "business_hours", "services", "coverage", "urgent_contact"]) {
    assert.equal(parse({ ...answers, [field]: "" }).ok, false, field);
  }
  for (const urgent_contact of ["Operator", "409-555-0100 ext 5", "409-555-0100 or 409-555-0101"]) {
    assert.equal(parse({ ...answers, urgent_contact }).error, "setup_transfer_number_required");
  }
  assert.equal(parse({ ...answers, coverage: "Always" }).error, "invalid_setup_choice");
  assert.equal(parse({ ...answers, booking: "Automatic activation" }).error, "invalid_setup_choice");
  assert.equal(parse({ ...answers, anything_else: "a".repeat(2001) }).error, "setup_answer_too_long");
  assert.equal(parse({ ...answers, services: {} }).error, "invalid_setup_answer");
  assert.equal(parse({ ...answers, contact_preference: "phone", phone: "" }).error, "phone_required_for_phone_followup");
});

test("setup retries share a key while changed answers create a new review and remain separate from pilot/audit", () => {
  const first = parse(answers).inquiry;
  assert.equal(proofPilotInquiryKey(first), proofPilotInquiryKey(parse({ ...answers }).inquiry));
  assert.notEqual(proofPilotInquiryKey(first), proofPilotInquiryKey(parse({ ...answers, services: "Maintenance" }).inquiry));
  assert.notEqual(proofPilotInquiryKey(first), proofPilotInquiryKey({ ...first, inquiryType: "pilot" }));
  assert.notEqual(proofPilotInquiryKey(first), proofPilotInquiryKey({ ...first, inquiryType: "audit" }));
});

test("full-length questionnaire is entirely saved in notes with a bounded setup review task", async t => {
  const payloads = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    payloads.push(JSON.parse(options.body));
    return Response.json({ note: { id: "synthetic-note" }, task: { id: "synthetic-task" } });
  });
  for (const contact_preference of ["email", "phone"]) {
    payloads.length = 0;
    const result = parse({ ...answers, contact_preference, services: "s".repeat(2000), urgent_definition: "u".repeat(2000), anything_else: "n".repeat(2000) });
    assert.equal(result.ok, true);
    const lead = proofPilotLead(result.inquiry);
    await createWixInquiryNotes({ apiKey: "synthetic-key", siteId: "synthetic-site", contactId: "synthetic-contact", text: lead.notes, retries: 0 });
    assert.equal(payloads.map(payload => payload.note.text).join(""), lead.notes);
    assert.ok(payloads.every(payload => payload.note.text.length <= 2048));
    for (const [key, value] of Object.entries(result.inquiry.setupAnswers)) {
      if (value) assert.ok(lead.notes.includes(`${key}: ${value}`), key);
    }
    payloads.length = 0;
    await createWixFollowupTask({ apiKey: "synthetic-key", siteId: "synthetic-site", contactId: "synthetic-contact", lead: proofPilotTaskLead(result.inquiry), retries: 0 });
    assert.match(payloads[0].task.title, /Customer setup review/);
    assert.ok(payloads[0].task.description.length <= 500);
    assert.doesNotMatch(payloads[0].task.description, /409-555-0100/);
    if (contact_preference === "email") assert.doesNotMatch(payloads[0].task.description, /Callback:/);
    else assert.match(payloads[0].task.description, /Callback: \+14095550199/);
  }
});
