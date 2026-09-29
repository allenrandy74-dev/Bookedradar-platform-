# BookedRadar service boundaries and scheduling assessment
Current commercial direction: September 29, 2026. See `../SERVICE_SCOPE_AND_PRICING.md` and `../PACKAGE_MATRIX.md` for current prices and inclusions.

| Offer | Scope | Commercial treatment |
| --- | --- | --- |
| Proof Pilot | Approved after-hours OR overflow evaluation; confirm-only requests | Up to 14 days or 25 real calls; no automatic paid conversion or expansion |
| RadarRecover continuation | Answering, recovery and owner intelligence, with accepted channels | $497/month standard or $397 approved Founding Partner; usage terms recorded |
| RadarSchedule | RadarGrow plus separately approved simple calendar booking | $897/month standard or $797 approved Founding Partner; activation remains gated |
| RadarDispatch | Technician/crew assignment, travel-aware scheduling and field coordination | Custom scope and quote |

Broader coverage requires a volume and operating-cost assessment. A customer's interest in scheduling does not authorize calendar writes. Package setup fees and custom implementation charges must be stated in the order; a founding waiver does not automatically waive custom dispatch work.

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
review cadence and which changes require a new quote. Pilot setup waiver does not
apply automatically to scheduling implementation.

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
