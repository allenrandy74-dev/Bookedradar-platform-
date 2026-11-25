# BookedRadar service boundaries and scheduling assessment
For current prices and inclusions, see the [service scope and pricing](../SERVICE_SCOPE_AND_PRICING.md) and [package matrix](../PACKAGE_MATRIX.md).

| Offer | Scheduling scope | Commercial terms |
| --- | --- | --- |
| Free Proof Pilot | Agreed after-hours or overflow intake. Staff confirm requested times. | Free for up to 14 days or 25 real calls, whichever comes first, or an earlier agreed limit. No automatic billing. |
| RadarRecover | Answering and recovery using accepted channels. Staff confirm requested times. | $179/month including 350 voice minutes per month. |
| RadarSchedule | Simple calendar booking after separate authorization and acceptance. | $349/month including 700 voice minutes per month. |
| RadarDispatch | Technician assignment, travel-aware scheduling and field coordination. | Price, usage and scope are individually quoted. |

Paid continuation requires separate explicit customer approval of the plan, price, scope and effective date. A scheduling inquiry does not authorize calendar writes. Any paid setup, implementation or usage charge requires separate agreement.

## Scheduling discovery worksheet
For each job type record: diagnostic/estimate/maintenance/repair; typical duration;
conservative duration; setup/cleanup; buffer; staff skills; crew size; equipment/parts;
required customer information; approved fees/deposit; conditions requiring review.
Do not schedule unknown repair duration as a fixed one-hour commitment.

For each technician record: approved job types; working hours; breaks; starting/ending
location; service boundaries; overtime rules; emergency capacity; maximum daily load.
Use operational locations only as needed and restrict access to staff location data.

Travel rules must consider the previous stop AND the next stop. Establish a maps
provider, traffic assumptions, parking/access allowance, maximum travel distance and
fallback when an address cannot be geocoded or routing is unavailable. Never promise
an arrival time based on straight-line distance alone.

Calendar integration must prevent overlapping bookings, recheck availability at
confirmation, handle concurrent requests, and avoid duplicates after retries. Define
the source of truth, appointment windows, lead time, time zone/DST, holidays,
rescheduling permissions, job-overrun handling and human override.

## Quote inputs — no price invented
Monthly calls/minutes; appointment volume; technicians; locations; calendars/CRMs;
job-type complexity; mapping/API costs; coverage hours; exception/support workload.
Specify implementation fee, recurring fee, included usage, extra usage treatment,
review cadence and which changes require a new quote. Document any paid scheduling implementation charge in the separate order.

## Acceptance before selling or enabling
Test neighboring-job travel conflicts, overlapping booking attempts, duplicate events,
unknown addresses, missing parts/skills, overtime, late jobs, unavailable calendars,
map failure, cancellation/rescheduling and customer notification. The customer must
approve the operating rules and test results. Start with predictable estimates,
inspections or maintenance appointments. Unsupported requests go to human review.

## Approved caller distinction
Pilot: "I've noted your preferred time. The team will confirm availability with you."
Direct scheduling: confirm a booking only after an approved calendar operation succeeds.
Never say a technician is dispatched merely because a lead or appointment request exists.
