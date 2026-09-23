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

test("Resend credentials configure native email adapter when enabled", () => {
  const configured = tenant();
  configured.integrations.email = { type: "resend", enabled: true };
  const adapters = buildTenantAdapters(configured, {
    env: {
      RESEND_API_KEY: "test-key",
      RESEND_FROM_EMAIL: "BookedRadar <notifications@mail.bookedradar.com>",
    },
  });
  assert.ok(adapters.email);
});

test("Wix follow-up includes the final intake details and caller notes", async (t) => {
  let task;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (url.includes("find-matching")) return Response.json({ contacts: [{ id: "contact-qa", name: { first: "Alex", last: "Smith" } }] });
    assert.equal(url, "https://www.wixapis.com/crm/tasks/v2/tasks");
    task = JSON.parse(options.body).task;
    return Response.json({ task: { id: "task-qa" } });
  });
  const adapters = buildTenantAdapters(tenant(), { env: { WIX_API_KEY: "test", WIX_SITE_ID: "test" } });
  const result = await adapters.human_task.send({
    action: { template: "phone_lead_review", opportunityId: "opp-qa" },
    contact: { name: "Alex Smith", phone: "+14095550100" },
    opportunity: { serviceType: "AC repair", urgency: "Urgent", metadata: {
      serviceAddress: "123 Oak Lane, Unit 2", city: "Silsbee", preferredWindow: "Tomorrow morning",
      notes: "Use the side entrance. Caller corrected the unit to 2.", callId: "call-qa",
    } },
  });
  assert.equal(result.taskId, "task-qa");
  assert.equal(task.contact.id, "contact-qa");
  for (const value of ["Alex Smith", "+14095550100", "AC repair", "Urgent", "123 Oak Lane, Unit 2", "Silsbee", "Tomorrow morning", "Use the side entrance. Caller corrected the unit to 2.", "opp-qa", "call-qa"]) {
    assert.ok(task.description.includes(value), `Missing task detail: ${value}`);
  }
});
