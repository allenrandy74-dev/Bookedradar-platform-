# Competitor call review and acceptance benchmark

Reviewed September 28, 2026. BookedRadar baseline: 4c4ae8e1728e9b856d5f933bdf97f0c9cc10bd5d.

## Evidence and limits

This is a review of one vendor-published call transcript, fictional call examples, and vendor documentation. No competitor live calls were placed and no microphone conversation was conducted. Available tools do not provide a supported means to speak into these voice demos. Audio was not listened to: timestamps describe transcript turn order, not measured audio latency or pauses. No competitor receives a live-test pass or comparative quality score. A selected demo cannot establish average production quality.

### FrontDeskPro: published call record, directly inspected in browser

Source: https://demo.frontdeskpro.ai/call/019fe433-d8b4-7c62-b7fb-5a828c4f7610
Linked publicly from https://frontdeskpro.ai/ . The displayed call date is January 23, 2026; duration 4:55.

Observed transcript sequence: an ambiguous window answer at 3:33 is followed by clarification, a clear choice at 3:46, a full appointment recap at 3:51, caller approval at 4:06, booking narration at 4:14, and a confirmation statement at 4:25. This supports the interaction pattern of clarify, recap, approval, action, result. It does not independently verify the calendar write.

Cautions in this sample: the agent asks system age and operating condition together. After a supplied name differs from a stored record, it reveals the stored name and asks for agreement. The page also shows a callback action beneath a booked outcome, leaving the reason for follow-up unclear. These are observations about one sample, not claims about all calls.

BookedRadar implication: retain one-question turns and caller-ID privacy; separate pending request from completed booking, and make next steps consistent with the saved outcome.

### BookedOnCall: explicitly fictional examples

Sources: https://www.bookedoncall.com/demo-calls and https://www.bookedoncall.com/examples

The demo page says no real appointments, texts, or customer records are created, and its retrieved state said currently unavailable. Its fictional HVAC example distinguishes urgent owner review from a promised dispatch and labels appointment requests as pending confirmation. However, the sample asks for several contact fields in one turn, then two further details together; the displayed address lacks a street number.

Implication: adopt clear outcome labels and demo boundaries; do not copy bundled intake questions or treat a street-only address as complete. These are authored examples, not independently observed voice behavior.

### Housecall Pro: product documentation, not tested behavior

Source: https://help.housecallpro.com/en/articles/9740104-csr-ai-overview

Documents configurable business context, separate booking/rescheduling/cancellation permissions, during-hours and after-hours escalation, and call outcome reporting. It instructs users to role-play through a microphone demo and retest after configuration changes. The article contains both older coming-soon language and enabled-booking descriptions; treat availability as account/configuration dependent rather than resolving that inconsistency by assumption.

Implication: evaluate each customer's actual configuration and permissions, not just a generic voice demo. Retest changes against the same scenarios.

### ServiceTitan: product documentation, not tested behavior

Source: https://www.servicetitan.com/features/pro/virtual-agent

Documents real-time booking using job type, location, technician skills, availability, business rules, and reporting. This supports a benchmark that checks the resulting appointment record and operational fit. No independent verification of those capabilities was performed.

Implication: a successful conversation is insufficient evidence for scheduling readiness. BookedRadar's confirmation-only demos must remain clearly distinguished from a verified live scheduling integration.

### NextPhone: vendor-described handling, not independently observed

Source: https://www.getnextphone.com/blog/ai-receptionist-complex-call-handling

Describes preserving multiple intents, clarifying ambiguous requests, correcting details without restarting intake, and providing human fallback after repeated misunderstanding. Its performance claims were not independently verified. The embedded audio was not evaluated.

Implication: add bounded misunderstanding and multiple-intent cases to the common acceptance benchmark. Preserve BookedRadar's explicit transfer consent instead of copying automatic escalation claims.

## Recommended changes and checks

1. Verify existing confirmation changes in real audio before adding more prompt wording. Expected: readback, question, complete caller answer, then action. No filler pretending agreement.
2. Extend multiple-request acceptance checks to every trade. Retain both service and billing/follow-up requests; do not silently overwrite the first when a second is added.
3. Make the closing state explicit: saved callback request, pending appointment request, tool-confirmed booking, or attempted transfer. Claims must match tool results; no invented callback deadline.
4. After repeated misunderstanding, offer an available human or callback path with permission. Do not endlessly repeat a field or transfer without agreement.
5. For future scheduling activation, require a sandbox booking plus verification of job type, duration, coverage, resource availability, caller consent, and exactly one resulting record. This review does not authorize activating scheduling or changing prices.

Items 1 and much of 3/4 already have prompt guidance. They need observed acceptance evidence. No runtime changes are made by this research document.

## Repeatable comparison scenarios — NOT YET EXECUTED

Use only explicitly public sandbox/demo endpoints and fictional details. Avoid creating real appointments or contacting a human business line. Do not send real customer data.

| Case | Caller stimulus | Required evidence |
| --- | --- | --- |
| Normal intake | Give name, service need, address and timing together | Uses all supplied details; asks only missing fields |
| Correction | Correct street number or spell a city | Final saved record preserves correction; no restart |
| Confirmation pause | Pause after readback, then correct it | Agent yields; silence is not agreement; no premature action |
| Urgency | Same-day electrical request, no reported immediate hazard | Waits for answer; distinguishes urgency from danger |
| Transfer declined | Roof replacement quote; decline live connection | No transfer; callback/intake continues |
| Direct human request | Ask for a person immediately | No mandatory full intake; truthful unavailable path |
| Multiple intents | Repair request plus question about an old invoice | Both retained; no invented billing action |
| Unknown policy | Ask an unconfigured price, warranty, or coverage question | Admits uncertainty and captures follow-up |
| Scheduling | Ask for a time; then change preference | No booking without available slot and explicit agreement |
| Failure and close | Transfer/save unavailable | Honest result and concrete next step, no false delivery claim |

For every run log provider, agent/config version, scenario, time, transcript/audio availability, observed turn order, corrected fields, action attempted, action result, saved summary, and next step. Score each criterion pass/fail/not observable; never count not observable as pass. Timing needs actual audio, not transcript timestamps. Any unauthorized transfer, fabricated booking, unsafe instruction, or lost correction is a failed case regardless of conversational polish.
