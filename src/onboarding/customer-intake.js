function clean(value) {
  return String(value ?? "").trim();
}
function list(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  return clean(value).split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
}
function slug(value) {
  return clean(value).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}
function secretPrefix(tenantId) {
  return tenantId.replace(/[^a-z0-9]/gi, "_").toUpperCase();
}
export function buildTenantDraftFromQuickStart(input = {}) {
  const businessName = clean(input.businessName);
  const tenantId = clean(input.tenantId) || slug(businessName);
  const serviceArea = list(input.serviceArea);
  const services = list(input.services);
  const escalationPhone = clean(input.escalationPhone);
  const bookingChoice = clean(input.bookingPreference).toLowerCase();
  const bookingMode = bookingChoice === "live_booking" || bookingChoice === "live booking" ? "live_booking" : "confirm_only";
  const tenant = {
    tenantId,
    businessName,
    trade: clean(input.trade),
    timeZone: clean(input.timeZone) || "America/Chicago",
    serviceArea,
    services,
    businessHours: input.businessHours || {},
    escalation: {
      humanPhone: escalationPhone,
      urgentAfterHours: input.urgentAfterHours !== false,
      safetyRule: clean(input.safetyRule),
    },
    policies: {
      bookingMode,
      quotePrices: Boolean(input.quotePrices),
      recordCalls: Boolean(input.recordCalls),
    },
    economics: {},
    integrations: {
      crm: { type: "customer_specific", enabled: false },
      phone: { type: "sip", enabled: false, inboundNumbers: [] },
      sms: { type: "twilio", enabled: false },
      email: { type: "webhook", enabled: false },
      calendar: { type: "customer_specific", enabled: false },
    },
    secretsPrefix: secretPrefix(tenantId),
    onboarding: {
      coverageMode: clean(input.coverageMode) || "after_hours_overflow",
      website: clean(input.website),
      customerTrackingSystem: clean(input.customerTrackingSystem),
      urgentDefinition: clean(input.urgentDefinition),
      notes: clean(input.notes),
      source: "quick_start",
    },
  };
  const needsFromCustomer = [];
  if (!businessName) needsFromCustomer.push("business_name");
  if (!tenant.trade) needsFromCustomer.push("business_type");
  if (!serviceArea.length) needsFromCustomer.push("service_area");
  if (!services.length) needsFromCustomer.push("services");
  if (!Object.keys(tenant.businessHours).length) needsFromCustomer.push("business_hours");
  if (!escalationPhone) needsFromCustomer.push("urgent_contact");
  const optionalFollowup = [];
  if (!tenant.onboarding.website) optionalFollowup.push("website");
  if (!tenant.onboarding.customerTrackingSystem) optionalFollowup.push("where_customer_information_is_kept");
  if (!tenant.onboarding.urgentDefinition) optionalFollowup.push("what_counts_as_urgent");
  return {
    tenant,
    needsFromCustomer,
    optionalFollowup,
    canGenerateTenant: needsFromCustomer.length === 0,
    next: needsFromCustomer.length ? "ASK_ONLY_FOR_MISSING_REQUIRED_ANSWERS" : "INTERNAL_ENRICHMENT_AND_READINESS",
  };
}
