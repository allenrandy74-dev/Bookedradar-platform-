import test from "node:test";
import assert from "node:assert/strict";
import { tenantReadiness } from "../src/onboarding/readiness.js";

function baseTenant() {
  return {
    tenantId: "pilot-hvac",
    businessName: "Pilot HVAC",
    trade: "HVAC",
    timeZone: "America/Chicago",
    serviceArea: ["Southeast Texas"],
    services: ["AC repair"],
    businessHours: { mon: ["08:00", "17:00"] },
    escalation: {
      humanPhone: "+14095550100",
      safetyRule: "Escalate emergencies appropriately."
    },
    policies: { bookingMode: "confirm_only" },
    integrations: {
      phone: { enabled: false, inboundNumbers: [] },
      crm: { enabled: false },
      sms: { enabled: false },
      email: { enabled: false },
      calendar: { enabled: false }
    },
    secretsPrefix: "PILOT_HVAC"
  };
}

test("complete confirm-only tenant is pilot ready", () => {
  const result = tenantReadiness(baseTenant(), { env: {} });
  assert.equal(result.ready, true);
  assert.equal(result.status, "READY");
  assert.equal(result.blockers.length, 0);
});

test("enabled phone without route blocks activation", () => {
  const tenant = baseTenant();
  tenant.integrations.phone.enabled = true;
  const result = tenantReadiness(tenant, { env: {} });
  assert.equal(result.ready, false);
  assert.ok(result.blockers.some((item) => item.code === "phone_route"));
});

test("enabled CRM without credentials blocks activation", () => {
  const tenant = baseTenant();
  tenant.integrations.crm = { enabled: true, type: "wix" };
  const result = tenantReadiness(tenant, { env: {} });
  assert.equal(result.ready, false);
  assert.ok(result.blockers.some((item) => item.code === "crm"));
});

test("tenant-prefixed Wix credentials satisfy CRM readiness", () => {
  const tenant = baseTenant();
  tenant.integrations.crm = { enabled: true, type: "wix" };
  const result = tenantReadiness(tenant, {
    env: {
      PILOT_HVAC_WIX_API_KEY: "test-key",
      PILOT_HVAC_WIX_SITE_ID: "test-site"
    }
  });
  assert.equal(result.ready, true);
  assert.ok(result.configuredAdapters.includes("human_task"));
  assert.ok(result.configuredAdapters.includes("human_alert"));
});

test("live booking without adapter blocks activation", () => {
  const tenant = baseTenant();
  tenant.policies.bookingMode = "live_booking";
  const result = tenantReadiness(tenant, { env: {} });
  assert.equal(result.ready, false);
  assert.ok(result.blockers.some((item) => item.code === "booking"));
});
