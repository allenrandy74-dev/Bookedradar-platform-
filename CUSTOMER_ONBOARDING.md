# BookedRadar Customer Onboarding

## Goal

Make onboarding feel simple to the customer and repeatable for BookedRadar. A customer should answer a short Quick Start once. BookedRadar should do the technical translation, configuration, testing, and provider-specific instructions.

## Customer Quick Start — required

Only six answers are required before BookedRadar can generate a tenant draft:

1. Business name and business type.
2. Service area.
3. Services offered.
4. Business hours.
5. Human escalation contact and phone number.
6. Coverage choice: after-hours, overflow, or broader call coverage.

Do not make a customer complete a long technical questionnaire before we can begin.

## Useful optional answers

Collect these when convenient, but do not block the first draft:

- Website.
- Current phone provider.
- Where customer/lead information is kept: Wix, Jobber, Housecall Pro, ServiceTitan, spreadsheet, other CRM, etc.
- What the business considers urgent.
- Whether BookedRadar should only capture preferred appointment windows or connect to live booking.
- Preferred reply-to email address.
- Anything unusual about how the business handles calls, estimates, cancellations, or emergencies.

## What the customer should NOT have to figure out

The customer does not need to know SIP, webhooks, API schemas, environment variables, tenant IDs, DNS terminology, or Render settings.

BookedRadar translates their answers into the technical setup.

## Phone setup

The customer keeps their existing business number unless there is a specific reason to change it.

BookRadar should ask for the phone provider and coverage mode, then provide provider-specific forwarding instructions. Typical setup:

- **After-hours:** forward calls outside business hours.
- **Overflow/no-answer:** forward after the business does not answer.
- **Full coverage:** route selected inbound calls to BookedRadar.

Customer instruction should always identify exactly:
- the number to forward to,
- which forwarding mode to choose,
- how to turn it on,
- how to turn it back off,
- and how to make one test call.

Do not ask the customer to share account passwords in email or chat. Use provider authorization/API credentials only when the integration actually requires them.

## CRM / customer records

Ask one simple question: **“Where do you keep customer and lead information today?”**

BookedRadar then chooses the adapter and gives only the steps needed for that system. Before activation, verify:
- contact create/reuse,
- follow-up task creation,
- duplicate protection,
- tenant isolation,
- and permission scope.

## Email

BookedRadar supports native Resend transactional sending. For a new tenant:
- sender identity must be approved,
- reply-to address should point to the customer or approved BookedRadar workflow,
- DNS must be verified when a customer-owned sending domain is used,
- and a synthetic delivery test must pass before customer-facing email is enabled.

## SMS

Do not enable customer-facing SMS until the sending number/campaign is approved and the adapter passes a live synthetic test. STOP/HELP behavior and opt-out suppression must be verified first.

## Booking

Default to **confirm-only**. The AI captures a preferred date/time window and says the team will confirm it.

Enable live booking only after the customer's actual calendar/dispatch system is connected and tested. Never invent availability.

## Internal plug-and-play activation checklist

For each new customer:

1. Create tenant ID and isolated secrets prefix.
2. Generate tenant config from Quick Start.
3. Normalize business hours and service area.
4. Add service catalog and business-specific safety rule.
5. Configure human escalation number.
6. Assign inbound BookedRadar route/number.
7. Configure provider-specific phone forwarding instructions.
8. Connect CRM if selected.
9. Enable Resend email only after sender verification and synthetic delivery.
10. Enable SMS only after carrier/campaign approval and STOP/HELP tests.
11. Configure booking adapter only if live booking is requested.
12. Run `tenantReadiness()`.
13. Run controlled CRM, email, and end-to-end smoke tests.
14. Run one live acceptance call with the customer.
15. Mark tenant pilot-ready only after all required checks pass.

## Customer acceptance test

Keep this simple. The customer should only need to verify:

1. “Call my normal business number using the chosen forwarding mode.”
2. Confirm BookedRadar identifies the business correctly.
3. Give a test name, service need, address, urgency, and preferred timing.
4. Ask for a human and confirm the transfer path works.
5. Confirm the business receives the expected lead information.
6. Confirm the CRM/task and approved notifications are created.
7. Confirm a normal goodbye when the caller has nothing else to add.

## Detailed safety / platform acceptance tests

Before a pilot handles real customers, BookedRadar internally verifies:

- Normal inbound service call.
- Caller asks for a human.
- Angry caller.
- Gas/fire/electrical/CO safety language.
- Missed call recovery.
- Web-lead fast response.
- Estimate follow-up.
- Cancellation recovery.
- Dormant contact without consent blocks marketing.
- Opt-out suppresses future actions.
- Confirm-only mode never promises an appointment.
- Recovered opportunity and confirmed revenue remain separate.
- Duplicate event does not create duplicate customer-facing actions.
- CRM create/reuse and linked task permissions.
- Transactional email delivery.
- Tenant-isolated credentials and routing.
