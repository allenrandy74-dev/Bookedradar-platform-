import { humanTransferTarget } from "../recovery/tenant-registry.js";
import { validateTenant } from "../recovery/tenant.js";
import { buildTenantAdapters, bookingAdapterForTenant, wixCredentialsForTenant } from "../integrations/tenant-adapters.js";

function add(items, code, message) {
  items.push({ code, message });
}

export function tenantReadiness(tenant, { env = process.env } = {}) {
  const blockers = [];
  const warnings = [];
  const checks = [];

  const base = validateTenant(tenant);
  checks.push({ code: "tenant_schema", ok: base.valid });
  for (const message of base.errors) add(blockers, "tenant_schema", message);

  const hours = tenant?.businessHours || {};
  const hasHours = Object.keys(hours).length > 0;
  checks.push({ code: "business_hours", ok: hasHours });
  if (!hasHours) add(blockers, "business_hours", "Business hours are required before pilot activation.");

  const services = Array.isArray(tenant?.services) ? tenant.services.filter(Boolean) : [];
  checks.push({ code: "services", ok: services.length > 0 });
  if (!services.length) add(warnings, "services", "No explicit service catalog is configured; operator guidance will be less specific.");

  const phone = tenant?.integrations?.phone || {};
  const inbound = Array.isArray(phone.inboundNumbers) ? phone.inboundNumbers.filter(Boolean) : [];
  const phoneReady = phone.enabled === true && inbound.length > 0 && inbound.every(number => /^\+[1-9]\d{7,14}$/.test(String(number)));
  checks.push({ code: "phone_route", ok: phoneReady });
  if (!phoneReady) add(blockers, "phone_route", "Phone must be enabled with valid E.164 inbound numbers before voice activation.");

  const adapters = buildTenantAdapters(tenant, { env });
  const crm = tenant?.integrations?.crm || {};
  const crmReady = !crm.enabled || Boolean(wixCredentialsForTenant(tenant, env));
  checks.push({ code: "crm", ok: crmReady });
  if (crm.enabled && !crmReady) add(blockers, "crm", "CRM is enabled but credentials/site configuration are incomplete.");

  const sms = tenant?.integrations?.sms || {};
  const smsReady = !sms.enabled || Boolean(adapters.sms);
  checks.push({ code: "sms", ok: smsReady });
  if (sms.enabled && !smsReady) add(blockers, "sms", "SMS is enabled but its adapter is not fully configured.");

  const email = tenant?.integrations?.email || {};
  const emailReady = !email.enabled || Boolean(adapters.email);
  checks.push({ code: "email", ok: emailReady });
  if (email.enabled && !emailReady) add(blockers, "email", "Email is enabled but its adapter is not fully configured.");

  const booking = bookingAdapterForTenant(tenant, { env });
  const liveBooking = tenant?.policies?.bookingMode === "live_booking";
  const commercial = tenant?.commercial || {};
  const schedulingScopeReady = !liveBooking || (
    ["scheduling", "scheduling_and_dispatch"].includes(commercial.serviceTier) &&
    commercial.schedulingApproved === true &&
    Boolean(String(commercial.schedulingAgreementReference || "").trim())
  );
  checks.push({ code: "scheduling_scope", ok: schedulingScopeReady });
  if (!schedulingScopeReady) add(blockers, "scheduling_scope", "Live booking requires a separately approved scheduling scope and agreement reference.");
  const bookingReady = !liveBooking || booking.constructor.name !== "ConfirmOnlyBookingAdapter";
  checks.push({ code: "booking", ok: bookingReady });
  if (!bookingReady) add(blockers, "booking", "Live booking is requested but no live booking adapter is configured.");

  const escalationPhone = humanTransferTarget(tenant, env);
  const escalationReady = /^\+[1-9]\d{7,14}$/.test(escalationPhone);
  checks.push({ code: "human_escalation", ok: escalationReady });
  if (!escalationReady) add(blockers, "human_escalation", "Human escalation phone must be a valid E.164 number.");

  const safetyReady = Boolean(String(tenant?.escalation?.safetyRule || "").trim());
  checks.push({ code: "safety_rule", ok: safetyReady });
  if (!safetyReady) add(warnings, "safety_rule", "No tenant-specific safety/escalation rule is configured.");

  const secretPrefixReady = Boolean(String(tenant?.secretsPrefix || "").trim());
  checks.push({ code: "secret_isolation", ok: secretPrefixReady });
  if (!secretPrefixReady) add(blockers, "secret_isolation", "A tenant-specific secretsPrefix is required for isolated customer credentials.");

  const ready = blockers.length === 0;
  return {
    tenantId: tenant?.tenantId || null,
    businessName: tenant?.businessName || null,
    ready,
    status: ready ? (warnings.length ? "READY_WITH_WARNINGS" : "READY") : "BLOCKED",
    blockers,
    warnings,
    checks,
    configuredAdapters: Object.keys(adapters),
    bookingAdapter: booking.constructor.name,
  };
}
