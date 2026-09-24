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
  // Transfers require one direct number. Never truncate a long number or
  // silently discard an extension and route a caller to the wrong person.
  if (/(?:\bext(?:ension)?\.?|\bx|#)\s*\d/i.test(raw)) return "";
  const matches = [...raw.matchAll(/(?<![\d+])(?:\+?1[ .-]?)?\(?[2-9]\d{2}\)?[ .-]?[2-9]\d{2}[ .-]?\d{4}(?!\d)/g)];
  if (matches.length !== 1) return "";
  const match = matches[0];
  const remainder = raw.slice(0, match.index) + raw.slice(match.index + match[0].length);
  if (/\d|\+/.test(remainder)) return "";
  const digits = match[0].replace(/\D/g, "");
  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

export function quickStartInputFromWixSubmission(submission = {}) {
  const values = submission?.submissions || submission || {};
  return {
    firstName: clean(values.first_name),
    businessName: clean(values.business_name),
    email: clean(values.email),
    phone: clean(values.phone),
    website: clean(values.website),
    trade: clean(values.business_type),
    serviceArea: clean(values.service_area),
    businessHoursText: clean(values.business_hours),
    services: clean(values.services),
    coverageMode: clean(values.coverage),
    phoneProvider: clean(values.phone_provider),
    escalationContactText: clean(values.urgent_contact),
    escalationPhone: extractUsPhone(values.urgent_contact),
    urgentDefinition: clean(values.urgent_definition),
    customerTrackingSystem: clean(values.customer_tracking),
    bookingPreference: clean(values.booking),
    emailReplyAddress: clean(values.email_reply_address),
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
  const escalationPhone = extractUsPhone(input.escalationPhone || input.escalationContactText);
  const bookingChoice = clean(input.bookingPreference).toLowerCase();
  // Customer interest is not commercial approval or permission to write a calendar.
  const bookingMode = "confirm_only";
  const schedulingRequested = /live.?booking|schedul|dispatch/.test(bookingChoice);

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
    commercial: {
      serviceTier: "founding_partner_pilot",
      schedulingApproved: false,
      schedulingAgreementReference: "",
    },
    economics: {},
    integrations: {
      crm: { type: "customer_specific", enabled: false },
      phone: {
        type: "sip",
        enabled: false,
        inboundNumbers: [],
        provider: clean(input.phoneProvider),
      },
      sms: { type: "twilio", enabled: false },
      email: {
        type: "resend",
        enabled: false,
        replyTo: clean(input.emailReplyAddress),
      },
      calendar: { type: "customer_specific", enabled: false },
    },
    secretsPrefix: secretPrefix(tenantId),
    onboarding: {
      firstName: clean(input.firstName),
      email: clean(input.email),
      phone: clean(input.phone),
      website: clean(input.website),
      requestedBookingPreference: clean(input.bookingPreference),
      schedulingReviewRequired: schedulingRequested,
      coverageMode: clean(input.coverageMode) || "after_hours_overflow",
      phoneProvider: clean(input.phoneProvider),
      businessHoursText,
      escalationContactText: clean(input.escalationContactText),
      customerTrackingSystem: clean(input.customerTrackingSystem),
      urgentDefinition: clean(input.urgentDefinition),
      emailReplyAddress: clean(input.emailReplyAddress),
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
  if (schedulingRequested) internalPreparation.push("prepare_separate_scheduling_scope_and_quote");
  if (businessHoursText && !Object.keys(structuredBusinessHours).length) {
    internalPreparation.push("normalize_business_hours");
  }
  if (!tenant.escalation.safetyRule) internalPreparation.push("prepare_safety_rule_for_customer_review");
  if (!tenant.onboarding.website) internalPreparation.push("website_optional_not_provided");

  const optionalFollowup = [];
  if (!tenant.onboarding.phoneProvider) optionalFollowup.push("phone_provider_for_forwarding_instructions");
  if (!tenant.onboarding.customerTrackingSystem) optionalFollowup.push("where_customer_information_is_kept");
  if (!tenant.onboarding.urgentDefinition) optionalFollowup.push("what_counts_as_urgent");
  if (!tenant.onboarding.emailReplyAddress) optionalFollowup.push("preferred_reply_to_email");

  const providerInstructionsNeeded = [];
  if (tenant.onboarding.phoneProvider) {
    providerInstructionsNeeded.push(`phone_forwarding:${tenant.onboarding.phoneProvider}`);
  } else {
    providerInstructionsNeeded.push("phone_forwarding:provider_unknown");
  }
  if (tenant.onboarding.customerTrackingSystem) {
    providerInstructionsNeeded.push(`crm_or_dispatch:${tenant.onboarding.customerTrackingSystem}`);
  }

  return {
    tenant,
    needsFromCustomer,
    internalPreparation,
    optionalFollowup,
    providerInstructionsNeeded,
    canGenerateTenant: needsFromCustomer.length === 0,
    setupPlan: {
      customerSteps: [
        "complete_quick_start",
        "approve_business_rules",
        "follow_phone_forwarding_instructions",
        "provide_provider_access_only_when_needed",
        "complete_acceptance_test",
      ],
      bookedRadarSteps: [
        "generate_tenant_config",
        "normalize_hours_and_rules",
        "configure_isolated_secrets",
        "assign_phone_route",
        "activate_crm_email_and_sms_when_ready",
        "run_readiness_gate",
        "run_acceptance_tests",
      ],
    },
    next: needsFromCustomer.length
      ? "ASK_ONLY_FOR_MISSING_REQUIRED_ANSWERS"
      : "INTERNAL_ENRICHMENT_AND_READINESS",
  };
}
