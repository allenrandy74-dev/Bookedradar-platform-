# BookedRadar Service Scope & Pricing

## Published prices for new paid service

| Paid plan | Monthly price (USD) | Included voice minutes per month |
| --- | ---: | ---: |
| RadarAnswer | $99 | 200 |
| RadarRecover | $179 | 350 |
| RadarGrow | $249 | 500 |
| RadarSchedule | $349 | 700 |
| RadarDispatch | Individually quoted | Individually quoted |

Any setup, extra usage or provider charges for paid service require separate agreement before activation. A paid plan or minute allowance never authorizes an extra pilot call.

The signed scope specifies which capabilities have passed customer-specific testing. Honor existing signed agreements. A new order uses the current offer unless a separate written agreement establishes different terms.

### Package intent

- **RadarAnswer:** answering, intake, escalation, caller continuity, spam screening, bilingual handling, Knowledge Gap Radar and owner visibility.
- **RadarRecover:** RadarAnswer plus missed-call/web-lead/estimate/cancellation recovery, RadarProof, Revenue Leak Radar, Owner Brief, Opportunity Timeline, Customer 360 and Review Radar.
- **RadarGrow:** RadarRecover plus membership-renewal intelligence and No-Show Guard after messaging/provider approval.
- **RadarSchedule:** Everything in RadarGrow plus separately approved simple live-calendar booking. It does **not** include technician routing or full field dispatch.
- **RadarDispatch:** custom full-time scheduling/dispatch scope with technician skills, geography, travel time, buffers, capacity and override rules.

## Free Proof Pilot

The Proof Pilot is free for qualified businesses. It ends at 14 days or 25 real calls, whichever comes first, or at an earlier agreed limit. There is no automatic billing. Paid service requires separate explicit customer approval of the plan, price, scope and effective date.

Agree on after-hours or overflow coverage, human escalation, a tested return route and the customer's authorization before accepting real calls. Record the authorized and actual UTC start, deadline and any lower call or time limit. Count unique, accepted non-test calls for this tenant. The admission control must stop new pilot calls at the earliest limit independently of periodic review. The routing owner verifies the original route and the final count. The customer can stop or request a separate paid order.

## RadarRecover paid scope

The published monthly price is $179 and includes 350 voice minutes per month. A separate signed order specifies coverage, enabled channels, integrations, limits and effective date. The following capabilities require customer-specific configuration and acceptance.

### Included

- AI answering for the agreed coverage window.
- After-hours, overflow/no-answer, or agreed broader inbound call coverage.
- Business-specific greeting and intake in English and Spanish when enabled for the tenant.
- Returning-caller continuity with identity-safe caller memory.
- Conservative spam/solicitor screening.
- Caller name, service need, address, urgency, preferred timing, and callback capture when applicable.
- CRM/contact and follow-up-task creation when the customer's supported CRM is connected.
- Human escalation/transfer using the approved transfer path.
- Transfer companion SMS to the configured receiving person when enabled and approved.
- Confirm-only scheduling: capture preferred date/time windows for the business to confirm.
- Approved transactional email/SMS notifications after provider readiness tests.
- In-call transactional texting and two-way SMS continuation after messaging approval/configuration.
- Embeddable website chat that feeds the same customer/recovery context when enabled.
- Missed-call/web-lead/recovery workflows that are explicitly enabled for the tenant.
- Knowledge Gap Radar: unanswered business-specific questions are recorded for knowledge-base improvement instead of guessed at.
- RadarProof reporting that separates diagnostic estimates from explicitly confirmed recovered revenue.
- Private searchable call history and text transcripts only when the customer explicitly approves transcript retention; audio recording is separate and remains off unless specifically approved/configured.
- Customer-specific service rules and safety/escalation guidance.
- One acceptance test before activation.

### Outside the standard RadarRecover scope

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

All qualified businesses may apply. Confirm capacity, the admission limit, customer acceptance and the return route for each actual tenant before activation. An application reserves neither capacity nor a paid subscription.
