import test from "node:test";
import assert from "node:assert/strict";
import { buildTenantDraftFromQuickStart } from "../src/onboarding/customer-intake.js";

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
