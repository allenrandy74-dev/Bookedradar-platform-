import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTenantAdapters,
  wixCredentialsForTenant,
} from "../src/integrations/tenant-adapters.js";

function tenant() {
  return {
    tenantId: "pilot",
    businessName: "Pilot HVAC",
    trade: "HVAC",
    timeZone: "America/Chicago",
    serviceArea: ["Test"],
    escalation: { humanPhone: "+14095550100" },
    policies: { bookingMode: "confirm_only" },
    integrations: {
      crm: { type: "wix", enabled: true },
      sms: { type: "twilio", enabled: false },
      email: { type: "webhook", enabled: false },
    },
    secretsPrefix: "PILOT",
  };
}

test("Wix credentials prefer tenant-specific secrets", () => {
  const env = {
    PILOT_WIX_API_KEY: "tenant-key",
    PILOT_WIX_SITE_ID: "tenant-site",
    WIX_API_KEY: "global-key",
    WIX_SITE_ID: "global-site",
  };
  assert.deepEqual(wixCredentialsForTenant(tenant(), env), {
    apiKey: "tenant-key",
    siteId: "tenant-site",
  });
});

test("Wix credentials fall back to global credentials for pilot tenants", () => {
  const env = {
    WIX_API_KEY: "global-key",
    WIX_SITE_ID: "global-site",
  };
  assert.deepEqual(wixCredentialsForTenant(tenant(), env), {
    apiKey: "global-key",
    siteId: "global-site",
  });
});

test("global Wix credentials configure human CRM adapters when CRM is enabled", () => {
  const env = {
    WIX_API_KEY: "global-key",
    WIX_SITE_ID: "global-site",
  };
  const adapters = buildTenantAdapters(tenant(), { env });
  assert.ok(adapters.human_task);
  assert.ok(adapters.human_alert);
});
