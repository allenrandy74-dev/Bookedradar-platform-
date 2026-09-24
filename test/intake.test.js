import test from "node:test";
import assert from "node:assert/strict";
import { normalizeIntake, isOptOutText } from "../src/intake.js";

test("dedicated estimate intake preserves estimate amount", () => {
  const event = normalizeIntake("estimate", {
    externalId: "est-1", email: "a@example.com", estimateAmount: 12345, serviceType: "replacement",
  });
  assert.equal(event.type, "estimate_sent");
  assert.equal(event.estimateAmount, 12345);
  assert.match(event.idempotencyKey, /^estimate:/);
});

test("STOP variants are recognized as opt-outs", () => {
  assert.equal(isOptOutText(" STOP "), true);
  assert.equal(isOptOutText("please stop"), false);
});


test("membership renewal intake preserves renewal metadata", () => {
  const event=normalizeIntake("membership-renewal",{membershipId:"m1",membershipName:"Gold",renewalDate:"2026-10-01",email:"a@example.com"});
  assert.equal(event.type,"membership_renewal_due");
  assert.equal(event.metadata.membershipId,"m1");
  assert.equal(event.metadata.membershipName,"Gold");
});

test("appointment reminder and earlier-slot intake preserve scheduling context", () => {
  const reminder=normalizeIntake("appointment-reminder",{appointmentId:"a1",scheduledFor:"2026-09-25T14:00:00Z",serviceAddress:"123 Oak",city:"Silsbee",phone:"+14095550100"});
  assert.equal(reminder.type,"appointment_reminder_due");
  assert.equal(reminder.metadata.city,"Silsbee");
  const wait=normalizeIntake("earlier-slot",{preferredWindow:"tomorrow morning",city:"Silsbee",serviceType:"AC repair",phone:"+14095550100"});
  assert.equal(wait.type,"earlier_slot_requested");
  assert.equal(wait.metadata.preferredWindow,"tomorrow morning");
});

test("completed-job intake preserves review safety signals", () => {
  const event=normalizeIntake("job-completed",{jobId:"j1",customerSatisfactionKnown:true,customerSatisfied:false,complaintOpen:true,email:"a@example.com"});
  assert.equal(event.type,"job_completed");
  assert.equal(event.metadata.complaintOpen,true);
  assert.equal(event.metadata.customerSatisfied,false);
});
