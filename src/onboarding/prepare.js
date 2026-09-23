import { buildTenantDraftFromQuickStart, quickStartInputFromWixSubmission } from "./customer-intake.js";
import { tenantReadiness } from "./readiness.js";

const FRIENDLY = {
  business_name: "Business name",
  business_type: "Type of business",
  service_area: "Service area",
  services: "Main services",
  business_hours: "Business hours",
  urgent_contact: "Who we should contact when a caller needs a person",
  where_customer_information_is_kept: "Where customer and lead information is kept",
  what_counts_as_urgent: "What usually counts as urgent",
};

export function prepareOnboardingFromWixSubmission(submission, { env = process.env } = {}) {
  const input = quickStartInputFromWixSubmission(submission);
  const draft = buildTenantDraftFromQuickStart(input);
  const readiness = tenantReadiness(draft.tenant, { env });

  const customerActions = draft.needsFromCustomer.map(code => ({
    code,
    label: FRIENDLY[code] || code,
    status: "WE_NEED_THIS_FROM_YOU",
  }));

  const handledByBookedRadar = [
    ...draft.internalPreparation,
    "tenant_configuration",
    "credential_and_integration_setup",
    "synthetic_acceptance_testing",
  ].map(code => ({ code, status: "WE_WILL_HANDLE_IT" }));

  const optional = draft.optionalFollowup.map(code => ({
    code,
    label: FRIENDLY[code] || code,
    status: "OPTIONAL_FOLLOWUP",
  }));

  return {
    submissionId: input.wixSubmissionId || null,
    tenantId: draft.tenant.tenantId || null,
    businessName: draft.tenant.businessName || null,
    canPrepareSetup: draft.canGenerateTenant,
    customerActions,
    handledByBookedRadar,
    optional,
    readiness,
    tenantDraft: draft.tenant,
    activationAllowed: false,
    next: draft.canGenerateTenant
      ? "BOOKEDRADAR_PREPARES_AND_TESTS_SETUP"
      : "ASK_ONLY_FOR_MISSING_REQUIRED_ANSWERS",
  };
}
