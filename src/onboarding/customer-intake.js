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
function extractUsPhone(value) {
  const raw = clean(value);
  if (!raw) return "";
  const plus = raw.match(/\+1\d{10}/);
  if (plus) return plus[0];
  const digits = raw.replace(/\D/g, "");
  const candidate = digits.length >= 11 && digits.includes("1")
    ? digits.slice(-11)
    : digits.slice(-10);
  if (/^1\d{10}$/.test(candidate)) return `+${candidate}`;
  if (/^\d{10}$/.test(candidate)) return `+1${candidate}`;
  return "";
}

export function quickStartInputFromWixSubmission(submission = {}) {
  const values = submission?.submissions || submission || {};
  return {
    firstName: clean(values.first_name),
    businessName: clean(values.business_name),
    email: clean(values.email),
    phone: clean(values.phone),
    trade: clean(values.business_type),
    serviceArea: clean(values.service_area),
    businessHoursText: clean(values.business_hours),
    services: clean(values.services),
    coverageMode: clean(values.coverage),
    escalationContactText: clean(values.urgent_contact),
    escalationPhone: extractUsPhone(values.urgent_contact),
    urgentDefinition: clean(values.urgent_definition),
    customerTrackingSystem: clean(values.customer_tracking),
    bookingPreference: clean(values.booking),
    notes: clean(values.anything_else),
    wixSubmissionId: clean(submission?.id),
    source: "wix_quick_start",
  };
}

export function buildTenantDraftFromQuickStart(input = {}) {
  const businessName = clean(input.businessName);
  const tenantId = clean(input.tenantId) || slug(businessName);
  const serviceArea = list(input.serviceArea);
  const services = list(input.services);
  const businessHoursText = clean(input.businessHoursText);
  const structuredBusinessHours =
    input.businessHours && typeof input.businessHours === "object" && !Array.isArray(input.businessHours)
      ? input.businessHours
      : {};
  const escalationPhone = clean(input.escalationPhone) || extractUsPhone(input.escalationContactText);
  const bookingChoice = clean(input.bookingPreference).toLowerCase();
  const bookingMode = bookingChoice === "live_booking" || bookingChoice === "live booking"
    ? "live_booking"
    : "confirm_only";

  const tenant = {
    tenantId,
    businessName,
    trade: clean(input.trade),
    timeZone: clean(input.timeZone) || "America/Chicago",
    serviceArea,
    services,
    businessHours: structuredBusinessHours,
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
      firstName: clean(input.firstName),
      email: clean(input.email),
      phone: clean(input.phone),
      coverageMode: clean(input.coverageMode) || "after_hours_overflow",
      website: clean(input.website),
      businessHoursText,
      escalationContactText: clean(input.escalationContactText),
      customerTrackingSystem: clean(input.customerTrackingSystem),
      urgentDefinition: clean(input.urgentDefinition),
      notes: clean(input.notes),
      wixSubmissionId: clean(input.wixSubmissionId),
      source: clean(input.source) || "quick_start",
    },
  };

  const needsFromCustomer = [];
  if (!businessName) needsFromCustomer.push("business_name");
  if (!tenant.trade) needsFromCustomer.push("business_type");
  if (!serviceArea.length) needsFromCustomer.push("service_area");
  if (!services.length) needsFromCustomer.push("services");
  if (!businessHoursText && !Object.keys(structuredBusinessHours).length) needsFromCustomer.push("business_hours");
  if (!escalationPhone) needsFromCustomer.push("urgent_contact");

  const internalPreparation = [];
  if (businessHoursText && !Object.keys(structuredBusinessHours).length) {
    internalPreparation.push("normalize_business_hours");
  }
  if (!tenant.escalation.safetyRule) internalPreparation.push("prepare_safety_rule_for_customer_review");
  if (!tenant.onboarding.website) internalPreparation.push("website_optional_not_provided");

  const optionalFollowup = [];
  if (!tenant.onboarding.customerTrackingSystem) optionalFollowup.push("where_customer_information_is_kept");
  if (!tenant.onboarding.urgentDefinition) optionalFollowup.push("what_counts_as_urgent");

  return {
    tenant,
    needsFromCustomer,
    internalPreparation,
    optionalFollowup,
    canGenerateTenant: needsFromCustomer.length === 0,
    next: needsFromCustomer.length
      ? "ASK_ONLY_FOR_MISSING_REQUIRED_ANSWERS"
      : "INTERNAL_ENRICHMENT_AND_READINESS",
  };
}
