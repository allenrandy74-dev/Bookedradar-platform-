# BookedRadar Service Scope & Pricing

## Recommended launch pricing

| Package | Standard monthly | Standard setup | Founding Partner monthly | Founding setup |
| --- | ---: | ---: | ---: | ---: |
| RadarAnswer | $149 | $199 | $149 | Waived |
| RadarRecover | $497 | $499 | $397 | Waived |
| RadarGrow | $697 | $749 | $597 | Waived |
| RadarSchedule | $897 | $999 | $797 | Waived |
| RadarDispatch | Custom | Custom | Custom | Custom |

These prices position BookedRadar above commodity answering services while remaining in the same general range as higher-touch AI receptionist/automation offerings. The pricing assumes BookedRadar is being sold as an operating and revenue-recovery layer, not simply by the minute.

**Important:** Do not publish unlimited-use or call-volume promises yet. Included usage/overage terms should be set only after production provider costs and pilot call volume are measured. Founding Partner pilots should use a clearly stated fair-use provision with no surprise overage billing unless separately agreed.

### Package intent

- **RadarAnswer:** answering, intake, escalation, caller continuity, spam screening, bilingual handling, Knowledge Gap Radar and owner visibility.
- **RadarRecover:** RadarAnswer plus missed-call/web-lead/estimate/cancellation recovery, RadarProof, Revenue Leak Radar, Owner Brief, Opportunity Timeline, Customer 360 and Review Radar.
- **RadarGrow:** RadarRecover plus membership-renewal intelligence and No-Show Guard after messaging/provider approval.
- **RadarSchedule:** Everything in RadarGrow plus separately approved simple live-calendar booking. It does **not** include technician routing or full field dispatch.
- **RadarDispatch:** custom full-time scheduling/dispatch scope with technician skills, geography, travel time, buffers, capacity and override rules.

## Founding Partner Pilot

**Standard RadarRecover price:** $497/month  
**Founding Partner RadarRecover price:** $397/month  
**Setup fee:** Waived for approved Founding Partners  
**Preferred payment method:** ACH; card available

The Founding Partner Pilot is designed as a revenue-recovery operating layer, not merely a phone-answering service. Voice, approved messaging, web lead capture, CRM follow-up and recovery attribution should preserve one opportunity context across channels and make the resulting value measurable.

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
