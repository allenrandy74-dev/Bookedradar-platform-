# BookedRadar Customer Onboarding Standard

## Goal
A new customer should be configuration-and-test work, not custom software development. No tenant is activated until required configuration and synthetic acceptance tests pass.

## 1. Customer discovery
Collect:
- Legal/business name and public-facing business name
- Trade/industry, timezone, service area, services offered
- Business hours and after-hours policy
- Primary and backup escalation contacts
- Emergency/safety rules and situations BookedRadar must not diagnose
- Quote/pricing policy
- Booking mode: confirm-only or approved live booking
- Average job values for RadarProof reporting
- Existing business phone number and desired routing: after-hours, overflow, or broader coverage
- CRM, email, SMS, calendar/booking systems
- FAQs, warranties, financing, memberships, service exclusions, and other approved answers

## 2. Tenant provisioning map
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
