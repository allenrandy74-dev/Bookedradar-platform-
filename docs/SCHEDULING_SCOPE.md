# BookedRadar service boundaries and scheduling assessment
Approved direction: September 24, 2026. Advanced pricing is not yet approved.

| Offer | Scope | Commercial treatment |
| --- | --- | --- |
| Founding Partner Pilot | Agreed answering, lead capture, routing, follow-up and appointment requests | $497/month; setup waived for first five qualified partners; written volume/usage terms required |
| Scheduling | Direct booking of approved, predictable job types against a supported calendar | Separate setup and monthly quote |
| Scheduling and dispatch | Technician/crew assignment, travel-aware scheduling and same-day changes | Custom scope and quote |

Full-time answering also requires a volume and coverage assessment. More answering
hours do not automatically authorize calendar access or imply the same $497 scope.

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
