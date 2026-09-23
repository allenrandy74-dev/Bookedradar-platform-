import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTenantDraftFromQuickStart,
  quickStartInputFromWixSubmission,
} from "../src/onboarding/customer-intake.js";

test("urgent contact accepts one direct US number and normalizes formatting", () => {
  for (const urgent_contact of ["Randy (409) 555-0100", "+1 409-555-0100", "4095550100"]) {
    assert.equal(quickStartInputFromWixSubmission({ submissions: { urgent_contact } }).escalationPhone, "+14095550100");
  }
  assert.equal(buildTenantDraftFromQuickStart({ escalationPhone: "(409) 555-0100" }).tenant.escalation.humanPhone, "+14095550100");
});

test("ambiguous or extension-based urgent contacts require clarification instead of misrouting", () => {
  for (const urgent_contact of ["409-555-0100 ext 123", "409-555-0100 x123", "409-555-0100 / 409-555-0199", "9994095550100", "+44 20 7946 0958", "ask Randy"]) {
    const input = quickStartInputFromWixSubmission({ submissions: { urgent_contact } });
    assert.equal(input.escalationPhone, "", urgent_contact);
    const result = buildTenantDraftFromQuickStart(input);
    assert.ok(result.needsFromCustomer.includes("urgent_contact"), urgent_contact);
  }
});

test("quick start turns plain-language answers into a tenant draft", () => {
  const result = buildTenantDraftFromQuickStart({
    businessName: "Allen Air & Heat",
    trade: "HVAC",
    serviceArea: "Silsbee, Lumberton, Beaumont",
    services: "AC repair, maintenance, replacement",
    businessHours: { mon: ["07:00", "18:00"] },
    escalationPhone: "+14095550100",
    coverageMode: "after_hours_overflow",
    customerTrackingSystem: "We use a spreadsheet",
    bookingPreference: "confirm only"
  });
  assert.equal(result.canGenerateTenant, true);
  assert.equal(result.tenant.tenantId, "allen-air-and-heat");
  assert.equal(result.tenant.secretsPrefix, "ALLEN_AIR_AND_HEAT");
  assert.equal(result.tenant.policies.bookingMode, "confirm_only");
  assert.deepEqual(result.tenant.serviceArea, ["Silsbee", "Lumberton", "Beaumont"]);
  assert.equal(result.tenant.integrations.crm.enabled, false);
});

test("quick start asks only for missing required information", () => {
  const result = buildTenantDraftFromQuickStart({ businessName: "Simple Plumbing" });
  assert.equal(result.canGenerateTenant, false);
  assert.ok(result.needsFromCustomer.includes("business_type"));
  assert.ok(result.needsFromCustomer.includes("business_hours"));
  assert.ok(result.needsFromCustomer.includes("urgent_contact"));
});

test("Wix Quick Start submission maps directly into onboarding input", () => {
  const input = quickStartInputFromWixSubmission({
    id: "submission-123",
    submissions: {
      first_name: "Randy",
      business_name: "Test Air",
      email: "owner@example.com",
      phone: "+14095550199",
      business_type: "HVAC",
      service_area: "Silsbee, Beaumont",
      business_hours: "Mon-Fri 8am-5pm",
      services: "AC repair, maintenance",
      coverage: "After hours",
      urgent_contact: "Randy (409) 555-0100",
      urgent_definition: "No cooling during extreme heat",
      customer_tracking: "A spreadsheet",
      booking: "Sometimes",
      anything_else: "Call owner for unusual situations"
    }
  });

  assert.equal(input.businessName, "Test Air");
  assert.equal(input.escalationPhone, "+14095550100");
  assert.equal(input.wixSubmissionId, "submission-123");

  const result = buildTenantDraftFromQuickStart(input);
  assert.equal(result.canGenerateTenant, true);
  assert.equal(result.tenant.onboarding.businessHoursText, "Mon-Fri 8am-5pm");
  assert.ok(result.internalPreparation.includes("normalize_business_hours"));
});
