# BookedRadar Customer Onboarding Checklist

Before a pilot handles live customers, collect and approve:

- Business legal/display name and trade.
- Service area and services offered.
- Business hours and after-hours policy.
- Human escalation number(s).
- Safety/emergency escalation policy.
- Whether the AI may discuss pricing; default is no.
- Booking mode: confirmation-only or live booking.
- Calendar/dispatch/field-service platform and credentials/scopes.
- CRM and customer-record source.
- Phone provider and call-routing setup.
- SMS provider and consent rules.
- Email sending account/domain.
- Existing estimate status/source and values.
- Cancellation/no-show data source.
- Dormant-customer eligibility definition.
- Average job values by service type.
- High-value opportunity threshold.
- Marketing consent fields and opt-out source of truth.
- Quiet hours / contact windows.
- Call-recording policy; default is off.
- Data retention period.
- Human review and pilot acceptance test contacts.

## Pilot acceptance tests

1. Normal inbound service call.
2. Caller asks for a human.
3. Angry caller.
4. Gas/fire/electrical/CO safety language.
5. Missed call enters recovery.
6. Web lead enters fast-response workflow.
7. Stale estimate schedules follow-up.
8. Cancellation starts reschedule recovery.
9. Dormant contact without consent blocks marketing.
10. Opt-out suppresses future actions.
11. Booking is never promised in confirm-only mode.
12. Recovered opportunity is marked separately from confirmed revenue.
13. Confirmed revenue updates RadarProof only after explicit confirmation.
14. Duplicate webhook/event does not produce duplicate customer-facing actions.
