import test from "node:test";
import assert from "node:assert/strict";

import {
  quickStartInputFromWixSubmission,
  buildTenantDraftFromQuickStart,
} from "../src/onboarding/customer-intake.js";

test("Quick Start maps optional provider fields without making them required", () => {
  const input = quickStartInputFromWixSubmission({
    id: "sub-1",
    submissions: {
      first_name: "Alex",
      business_name: "Alex HVAC",
      email: "alex@example.com",
      phone: "409-555-0100",
      website: "https://example.com",
      business_type: "HVAC",
      service_area: "Silsbee, Lumberton",
      business_hours: "Mon-Fri 7am-6pm",
      services: "Repair, Maintenance",
      coverage: "After hours",
      urgent_contact: "Alex 409-555-0199",
      phone_provider: "AT&T",
      customer_tracking: "",
      booking: "",
      email_reply_address: "dispatch@example.com",
    },
  });

  assert.equal(input.website, "https://example.com");
  assert.equal(input.phoneProvider, "AT&T");
  assert.equal(input.emailReplyAddress, "dispatch@example.com");
  assert.equal(input.escalationPhone, "+14095550199");
});

test("Tenant draft is generatable from the minimal business answers and defaults email to Resend", () => {
  const draft = buildTenantDraftFromQuickStart({
    firstName: "Alex",
    businessName: "Alex HVAC",
    email: "alex@example.com",
    phone: "409-555-0100",
    trade: "HVAC",
    serviceArea: "Silsbee, Lumberton",
    businessHoursText: "Mon-Fri 7am-6pm",
    services: "Repair, Maintenance",
    coverageMode: "After hours",
    escalationContactText: "Alex 409-555-0199",
  });

  assert.equal(draft.canGenerateTenant, true);
  assert.deepEqual(draft.needsFromCustomer, []);
  assert.equal(draft.tenant.integrations.email.type, "resend");
  assert.equal(draft.tenant.integrations.email.enabled, false);
  assert.ok(draft.optionalFollowup.includes("phone_provider_for_forwarding_instructions"));
  assert.ok(draft.optionalFollowup.includes("where_customer_information_is_kept"));
  assert.ok(draft.optionalFollowup.includes("preferred_reply_to_email"));
  assert.equal(draft.next, "INTERNAL_ENRICHMENT_AND_READINESS");
});
