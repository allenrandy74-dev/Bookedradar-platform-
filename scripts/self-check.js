import { TenantRegistry, tenantSecret } from "../src/recovery/tenant-registry.js";
import { bookingAdapterForTenant } from "../src/integrations/tenant-adapters.js";
const dir = process.env.TENANT_CONFIG_DIR || "./config/tenants";
const registry = await TenantRegistry.loadDirectory(dir);
let failures = 0;
const rows = [];
for (const tenant of registry.list()) {
  const phone = tenant?.integrations?.phone || {};
  const sms = tenant?.integrations?.sms || {};
  const email = tenant?.integrations?.email || {};
  const crm = tenant?.integrations?.crm || {};
  const row = {
    tenantId: tenant.tenantId,
    inboundNumbers: phone.inboundNumbers?.length || 0,
    phoneConfigured: !phone.enabled || Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_WEBHOOK_SECRET),
    smsConfigured: !sms.enabled || Boolean(sms.type === "twilio" && tenantSecret(tenant,"TWILIO_ACCOUNT_SID") && tenantSecret(tenant,"TWILIO_AUTH_TOKEN") && tenantSecret(tenant,"TWILIO_SMS_FROM")),
    emailConfigured: !email.enabled || Boolean(email.type === "webhook" && tenantSecret(tenant,"EMAIL_WEBHOOK_URL")),
    crmConfigured: !crm.enabled || Boolean(crm.type === "wix" && tenantSecret(tenant,"WIX_API_KEY") && tenantSecret(tenant,"WIX_SITE_ID")),
    adminTokenConfigured: Boolean(process.env.BOOKEDRADAR_ADMIN_TOKEN),
    ingestTokenConfigured: Boolean(process.env.BOOKEDRADAR_INGEST_TOKEN),
    liveBookingSafe:
      tenant?.policies?.bookingMode !== "live_booking" ||
      bookingAdapterForTenant(tenant).constructor.name !== "ConfirmOnlyBookingAdapter",
  };
  for (const [k,v] of Object.entries(row)) if ((k.endsWith("Configured") || k.endsWith("Safe")) && v === false) failures++;
  rows.push(row);
}
console.table(rows);
if (failures) { console.error(`SELF-CHECK: ${failures} readiness gap(s) found.`); process.exitCode=2; }
else console.log("SELF-CHECK: PASS");
