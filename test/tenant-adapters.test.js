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

test("global Wix credentials cannot configure an unconfigured customer", () => {
  const env = { WIX_API_KEY: "global-key", WIX_SITE_ID: "global-site" };
  assert.equal(wixCredentialsForTenant(tenant(), env), null);
  const adapters = buildTenantAdapters(tenant(), { env });
  assert.equal(adapters.human_task, undefined);
  assert.equal(adapters.human_alert, undefined);
});

test("partial customer credentials cannot mix with another site", () => {
  const env = { PILOT_WIX_API_KEY: "tenant-key", WIX_SITE_ID: "global-site", OTHER_WIX_SITE_ID: "other-site" };
  assert.equal(wixCredentialsForTenant(tenant(), env), null);
  assert.equal(buildTenantAdapters(tenant(), { env }).human_task, undefined);
});

test("Resend credentials configure native email adapter when enabled", () => {
  const configured = tenant();
  configured.integrations.email = { type: "resend", enabled: true };
  const adapters = buildTenantAdapters(configured, {
    env: {
      PILOT_RESEND_API_KEY: "test-key",
      PILOT_RESEND_FROM_EMAIL: "BookedRadar <notifications@mail.bookedradar.com>",
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
  const adapters = buildTenantAdapters(tenant(), { env: { PILOT_WIX_API_KEY: "test", PILOT_WIX_SITE_ID: "test" } });
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


test("unconfigured customer cannot inherit global email, webhook, or SMS settings", () => {
  const env = { RESEND_API_KEY: "global", RESEND_FROM_EMAIL: "global@example.com", RESEND_REPLY_TO: "global-replies@example.com", EMAIL_WEBHOOK_URL: "https://global.example.com", EMAIL_WEBHOOK_TOKEN: "global", TWILIO_ACCOUNT_SID: "global", TWILIO_AUTH_TOKEN: "global", TWILIO_SMS_FROM: "+14095550100" };
  for (const type of ["resend", "webhook"]) {
    const configured = tenant();
    configured.integrations.email = { type, enabled: true };
    configured.integrations.sms = { type: "twilio", enabled: true };
    const adapters = buildTenantAdapters(configured, { env });
    assert.equal(adapters.email, undefined);
    assert.equal(adapters.sms, undefined);
  }
});

test("partial customer sender settings cannot borrow global sender or token", () => {
  const configured = tenant();
  configured.integrations.email = { type: "resend", enabled: true };
  configured.integrations.sms = { type: "twilio", enabled: true };
  const adapters = buildTenantAdapters(configured, { env: { PILOT_RESEND_API_KEY: "own-key", RESEND_FROM_EMAIL: "global@example.com", PILOT_TWILIO_ACCOUNT_SID: "own-account", PILOT_TWILIO_SMS_FROM: "+14095550101", TWILIO_AUTH_TOKEN: "global-token" } });
  assert.equal(adapters.email, undefined);
  assert.equal(adapters.sms, undefined);
});

test("two customers keep their own sender, reply address, and provider credentials", () => {
  const env = { RESEND_REPLY_TO: "global@example.com" };
  for (const prefix of ["A", "B"]) {
    Object.assign(env, { [prefix+"_RESEND_API_KEY"]: prefix+"-key", [prefix+"_RESEND_FROM_EMAIL"]: prefix+"@example.com", [prefix+"_TWILIO_ACCOUNT_SID"]: prefix+"-account", [prefix+"_TWILIO_AUTH_TOKEN"]: prefix+"-token", [prefix+"_TWILIO_SMS_FROM"]: prefix === "A" ? "+14095550101" : "+14095550102" });
  }
  env.A_RESEND_REPLY_TO = "a-replies@example.com";
  for (const prefix of ["A", "B"]) {
    const configured = tenant(); configured.secretsPrefix = prefix;
    configured.integrations.email = { type: "resend", enabled: true };
    configured.integrations.sms = { type: "twilio", enabled: true };
    const a = buildTenantAdapters(configured, { env });
    assert.equal(a.email.apiKey, prefix+"-key");
    assert.equal(a.email.from, prefix+"@example.com");
    assert.equal(a.email.replyTo, prefix === "A" ? "a-replies@example.com" : "");
    assert.equal(a.sms.accountSid, prefix+"-account");
    assert.equal(a.sms.authToken, prefix+"-token");
    assert.equal(a.sms.fromNumber, prefix === "A" ? "+14095550101" : "+14095550102");
  }
});
