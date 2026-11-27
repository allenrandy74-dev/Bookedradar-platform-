# BookedRadar Customer Onboarding Standard

## Goal
A new customer should be configuration-and-test work, not custom software development. No tenant is activated until required configuration and synthetic acceptance tests pass.

## 1. Customer discovery
Collect:
- Setup contact preference: email only by default, or an explicitly requested call
- Legal/business name and public-facing business name
- Trade/industry, timezone, service area, services offered
- Business hours and after-hours policy
- Primary and backup escalation contacts
- Emergency/safety rules and situations BookedRadar must not diagnose
- Quote/pricing policy
- Booking mode: appointment requests by default; direct booking requires a separate scheduling agreement
- Average job values for RadarProof reporting
- Existing business phone number and desired routing: after-hours, overflow, or broader coverage
- CRM, email, SMS, calendar/booking systems
- FAQs, warranties, financing, memberships, service exclusions, and other approved answers

Keep setup follow-up separate from caller escalation. Email-only customers still
provide a direct number for callers who need a person, but that number must not
be used for setup or sales calls. Review the saved `contact_preference` and the
operator note before follow-up. Missing preferences default to email; clarify
legacy choices in writing rather than inferring permission from a phone number.

## 2. Tenant provisioning map

### Prepare a draft from the hosted Quick Start

1. Open the Wix CRM **AI phone lead — Customer setup review** task and the linked contact's notes.
   Confirm the linked contact and business, and use the note timestamps to identify the
   corresponding submission. Use one report, from
   `Customer setup questionnaire` through `Source: bookedradar.com/setup`. Long reports may span
   consecutive notes. Read the chunks in order and join their text directly, since a chunk can
   split an answer mid-line. If the report is incomplete or its order is unclear, reconcile it
   before preparing the draft.
2. In a private operator workspace, transcribe the answers into a JSON object named `submissions`.
   The accepted keys are `first_name`, `business_name`, `email`, `contact_preference`, `phone`,
   `business_type`, `service_area`, `business_hours`, `services`, `coverage`, `urgent_contact`,
   `urgent_definition`, `customer_tracking`, `booking`, and `anything_else`. Keep multiline
   answers in one JSON string per field, using `\n` for line breaks. Text within an answer can
   look like a field label. Review the boundaries against the whole report before copying.
   Leave an absent optional answer empty or omit the key.
3. Send `{"submissions": {…}}` to `POST /api/v1/onboarding/prepare` from the private operator
   environment with the existing admin authorization. Keep the token and submission out of
   shared logs, public pages and source control. Use `urgent_contact` for the caller-transfer
   destination. Include `phone` only for a separately requested setup call. If a signed service
   order specifies a standard package, an operator can add `service_profile` as `answer`,
   `recover`, `grow`, or `schedule`. Confirm the purchased package from the signed order.
   Handle custom Dispatch separately.
4. Review `tenantDraft`, `customerActions` and `readiness` against the questionnaire and approved
   scope. Check that the draft honors the follow-up preference and preserves the separate
   transfer destination. A prepared draft has `activationAllowed: false`. Complete the customer
   activation checklist and obtain the required approvals before changing routing, enabling
   integrations or starting billing.

Onboarding answers map to these tenant fields:
- Identity: tenantId, businessName, trade, timeZone
- Operations: serviceArea, services, businessHours
- Escalation: humanPhone, urgentAfterHours, safetyRule
- Policies: bookingMode, quietHours, SMS policy, recordCalls, quotePrices
- Economics: defaultAverageJobValue, averageJobValueByType, highValueThreshold
- Integrations: phone, CRM, SMS, email, calendar
- Secret isolation: secretsPrefix

Credentials are never stored in the tenant JSON when a tenant-prefixed environment secret can be used.

## 3. Readiness gate
Run `npm run onboarding:readiness`.

A tenant is BLOCKED if any required tenant field is missing, escalation phone is invalid, secret isolation is missing, an enabled phone has no inbound route, an enabled CRM/email/SMS adapter lacks configuration, or live booking is requested without a live booking adapter.

Warnings identify non-blocking gaps such as a missing explicit service catalog or tenant-specific safety rule.

## 4. Synthetic acceptance
Before customer traffic:
1. Routine lead with full information.
2. Lead missing optional information.
3. Urgent lead.
4. Exact service address capture.
5. Preferred timing capture.
6. Human escalation request.
7. Duplicate/repeated lead handling.
8. CRM contact/task creation.
9. Human alert generation.
10. Email notification when verified and enabled.
11. SMS notification only after messaging approval and explicit enablement.
12. Confirm-only booking behavior or live-booking integration, as contracted.
13. Failure/retry behavior for unavailable integrations.
14. Tenant isolation: no data or routing crosses customers.

Delete synthetic CRM records after testing.

## 5. Customer acceptance
The owner/team performs a controlled test and approves:
- Greeting and business identity
- Questions asked and information captured
- FAQs and prohibited promises
- Urgency and safety behavior
- Transfer/escalation behavior
- Closing language
- Notifications and CRM records

## 6. Go-live
Start with the contracted routing mode. For early pilots, prefer controlled after-hours/overflow activation. Confirm monitoring, rollback path, and human escalation before enabling traffic.

## 7. First-week review
Review every abnormal event, lead completeness, transfers, CRM writes, notification delivery, retries, and customer feedback. Correct configuration before expanding scope.

## 8. 30-day review
Report leads handled, recoveries, booked/recovered value where attributable, response performance, failures, and customer feedback through RadarProof.

## Activation rule
No customer capability is sold or enabled merely because code exists. It must be configured for that tenant and pass the applicable acceptance test first.

## Commercial readiness for direct scheduling
Quick Start captures interest only and always produces a confirm-only tenant draft.
A scheduling operator must separately set commercial.serviceTier to scheduling or
scheduling_and_dispatch, schedulingApproved to true, and schedulingAgreementReference
to the approved order. The readiness gate also requires a working booking adapter.
These checks do not establish that travel-aware scheduling exists: each contracted
capability still needs its own rules, implementation and acceptance evidence.
