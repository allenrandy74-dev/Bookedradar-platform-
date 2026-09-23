import test from "node:test";
import assert from "node:assert/strict";
import { prepareOnboardingFromWixSubmission } from "../src/onboarding/prepare.js";

test("complete Wix Quick Start becomes a prepared setup with no repeated customer questions", () => {
  const result = prepareOnboardingFromWixSubmission({
    id: "sub-1",
    submissions: {
      first_name: "Jamie",
      business_name: "Simple Air",
      email: "owner@example.com",
      phone: "+14095550199",
      business_type: "HVAC",
      service_area: "Silsbee, Beaumont",
      business_hours: "Mon-Fri 8am-5pm",
      services: "AC repair, maintenance",
      coverage: "After hours",
      urgent_contact: "Jamie 409-555-0100",
      urgent_definition: "No cooling during extreme heat",
      customer_tracking: "A spreadsheet",
      booking: "Sometimes"
    }
  }, { env: {} });

  assert.equal(result.canPrepareSetup, true);
  assert.equal(result.customerActions.length, 0);
  assert.equal(result.next, "BOOKEDRADAR_PREPARES_AND_TESTS_SETUP");
  assert.equal(result.activationAllowed, false);
  assert.ok(result.handledByBookedRadar.some(item => item.code === "normalize_business_hours"));
});

test("incomplete Wix Quick Start asks only for the missing required items", () => {
  const result = prepareOnboardingFromWixSubmission({
    id: "sub-2",
    submissions: { business_name: "Simple Plumbing" }
  }, { env: {} });

  assert.equal(result.canPrepareSetup, false);
  assert.ok(result.customerActions.some(item => item.code === "business_type"));
  assert.ok(result.customerActions.some(item => item.code === "urgent_contact"));
  assert.equal(result.next, "ASK_ONLY_FOR_MISSING_REQUIRED_ANSWERS");
});
