# BookedRadar Service Map

BookedRadar is built as a revenue-recovery layer for home-service businesses.

## 1. Live AI Phone Operator
Answers inbound calls, gathers service details, identifies urgency, captures preferred scheduling windows, and escalates to a human when needed. It does not pretend to be human and does not invent availability or prices.

## 2. Missed-Call Recovery
Turns a missed inbound call into a tracked opportunity. A policy-controlled follow-up sequence can send an acknowledgement, create a callback task, and continue recovery until the opportunity is resolved.

## 3. Web-Lead Response
Captures website/form leads immediately, acknowledges receipt, creates a fast-response task, and prevents requests from waiting unnoticed.

## 4. After-Hours / Overflow
Acknowledges after-hours inquiries, flags urgent situations, and creates the appropriate morning follow-up without falsely promising an appointment.

## 5. Estimate Follow-Up
Tracks estimates that have not converted and schedules professional follow-up. High-value jobs can be escalated to a human rather than left to automation.

## 6. Cancellation Recovery
Offers a path to reschedule cancelled appointments and creates an operational task to recover the customer or fill the newly open slot.

## 7. Dormant-Customer Reactivation
Creates permission-aware reactivation campaigns. Marketing actions are blocked unless the customer record indicates the required consent.

## 8. Capacity-Aware Booking
The platform supports two modes:
- `confirm_only`: collect preferred windows and let a person confirm.
- `live_booking`: only enabled after a customer's real calendar/dispatch system is connected.

## 9. Human Escalation
Safety-sensitive calls, angry callers, unusual requests, payment/legal issues, high-value opportunities, or anyone asking for a person are routed to human handling.

## 10. Suppression and Opt-Out
Opt-outs create a suppression state. Future automated outreach is blocked.

## 11. RadarProof Attribution
Tracks:
- opportunities captured,
- opportunities recovered,
- estimated opportunity value,
- estimated recovered value,
- confirmed revenue,
- response timing,
- actions pending/blocked,
- recovery by source.

Estimated values and confirmed revenue are always reported separately.

## 12. CRM / Communication Integration
Adapters are intended to connect BookedRadar to the customer's existing systems instead of forcing a replacement. The current build includes Wix CRM integration for contact/task handling and is structured for phone, SMS, email, calendar, and field-service adapters.
