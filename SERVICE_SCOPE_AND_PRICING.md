# BookedRadar Service Scope & Pricing

## Founding Partner Pilot

**Price:** $497/month  
**Setup fee:** Waived for approved Founding Partners  
**Preferred payment method:** ACH; card available

The Founding Partner Pilot is designed to prove measurable value while keeping the initial service simple, reliable, and repeatable.

### Included

- AI answering for the agreed coverage window.
- After-hours, overflow/no-answer, or agreed broader inbound call coverage.
- Business-specific greeting and intake.
- Caller name, service need, address, urgency, preferred timing, and callback capture when applicable.
- CRM/contact and follow-up-task creation when the customer's supported CRM is connected.
- Human escalation/transfer using the approved transfer path.
- Transfer companion SMS to the configured receiving person when enabled and approved.
- Confirm-only scheduling: capture preferred date/time windows for the business to confirm.
- Approved transactional email/SMS notifications after provider readiness tests.
- Missed-call/web-lead/recovery workflows that are explicitly enabled for the tenant.
- Customer-specific service rules and safety/escalation guidance.
- One acceptance test before activation.

### Not included in the $497 pilot unless separately approved

- Full-time live scheduling or dispatch.
- Writing appointments directly into a live calendar/dispatch system.
- Route optimization or technician assignment.
- Real-time travel-time management.
- Pricing/quote authority.
- Taking deposits or customer payments on behalf of the client.
- Custom integrations not covered by an existing BookedRadar adapter.
- High-volume or unusually complex routing that materially changes operating cost.
- Human staffing supplied by BookedRadar.

## Full-time Scheduling / Dispatch

Full-time scheduling/dispatch is a separate commercial scope and is **custom quoted**.

It requires significantly more customer-specific configuration because BookedRadar must understand job duration, technician/crew capability, travel time, service territories, buffers, priority rules, cancellation/reschedule rules, system-of-record behavior, and who may override the schedule.

A customer requesting this service must complete the scheduling/dispatch discovery checklist in `CUSTOMER_ONBOARDING.md`.

### Activation requirements

Live scheduling/dispatch may be activated only when all of the following are true:

1. The customer has requested the service.
2. BookedRadar has documented the operating rules.
3. The scheduling/dispatch integration is connected and tested.
4. Simulation tests show that duration, travel, and capacity rules behave correctly.
5. The customer has approved the separate price and service scope.
6. The tenant configuration contains an agreement reference.
7. The customer completes a live acceptance test.

Until then, the tenant remains in **confirm-only** mode.

## Commercial guardrail

Customer interest is not commercial approval. A Quick Start answer such as "yes, schedule for me" must never by itself authorize live calendar writes, dispatch, or a higher-cost service.

## Pilot capacity

The current billing implementation supports up to five Founding Partner pilot accounts. Expanding beyond that limit should happen only after the first group has validated onboarding, support load, provider costs, and retention.
