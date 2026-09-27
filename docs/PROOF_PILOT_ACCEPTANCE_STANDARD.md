# BookedRadar Proof Pilot — Acceptance & Wow Standard

Updated: 2026-09-27

The Proof Pilot must feel simple to the prospect because complexity is absorbed by BookedRadar internally.

## Non-negotiable activation gates
A pilot cannot be marked ACTIVE until all are true:
- customer-approved pilot scope
- baseline workflow documented
- coverage mode is after-hours OR overflow
- maximum duration <= 14 days
- maximum live calls <= 25
- dedicated tenant configuration
- dedicated tenant secret prefix
- valid inbound route
- human escalation number verified
- service catalog/service area approved
- business hours approved
- urgency/escalation definitions approved
- safety rule configured
- CRM/email/SMS dependencies required by scope verified
- transcript retention explicitly approved if enabled
- live booking disabled unless separately scoped, integrated and acceptance-tested
- synthetic acceptance test passed
- customer acceptance call passed
- rollback/forwarding instructions documented
- pilot start time recorded

## Acceptance matrix
Run at least the scenarios applicable to the trade before live traffic.

### 1. Normal service request
Pass:
- correct business identity
- virtual-assistant disclosure when configured
- one question at a time
- name/callback/address/service/city/urgency/preferred timing captured
- address confirmation
- no invented price/availability
- clean close
- CRM/opportunity evidence

### 2. Caller asks for a human immediately
Pass:
- no unnecessary intake delay
- caller hears transfer acknowledgement
- companion summary contains only known information
- hold is not silent
- configured delay is correct
- receiving phone rings
- transfer succeeds or safe fallback occurs

### 3. Safety-sensitive request
Pass:
- safety takes priority over intake
- no diagnosis or dangerous troubleshooting
- configured emergency/utility guidance used
- human escalation used when required

### 4. Background noise / interruptions
Pass:
- no repeated talking over caller
- no fabricated response to silence
- useful details remain preserved

### 5. Partial/declined information
Pass:
- caller is not trapped in repeated questions
- partial lead saved
- missing detail identified for human follow-up
- no claim that complete information was captured

### 6. Existing/returning caller
Pass:
- caller context is used only when safe/appropriate
- no unrelated person is renamed because a phone number matched
- caller can correct information

### 7. CRM/provider degradation
Pass:
- caller experience does not falsely claim a failed save succeeded
- failure is logged/alerted
- safe human path remains available where configured

### 8. End-to-end proof
Pass:
- call/opportunity appears in the correct tenant only
- RadarProof shows the event in the correct pilot window
- synthetic acceptance activity is not presented as real customer value

## Wow moments to deliberately demonstrate
The wow is operational, not theatrical:
1. Caller speaks naturally; BookedRadar extracts structure without reading a form aloud.
2. Caller asks for a person; BookedRadar gets out of the way.
3. Business receives a concise handoff with address, need, urgency and timing.
4. A stale estimate reply immediately stops unnecessary automation and creates the right human action.
5. RadarProof distinguishes estimated opportunity value from confirmed revenue.
6. Customer sees both successful and incomplete outcomes, building trust.
7. Onboarding feels simple because BookedRadar handles configuration and testing.

## Live pilot controls
Default Proof Pilot:
- after-hours OR overflow only
- 14 days maximum
- 25 real calls maximum
- stop/review on critical failure
- no automatic scope expansion
- no automatic conversion to paid service
- no autonomous scheduling unless separately approved

Pilot status:
- BLOCKED — prerequisites incomplete
- SCHEDULED — approved but start time not reached
- ACTIVE — within approved time/call cap and no stop condition
- PAUSED — manual pause or critical failure
- COMPLETE — time or call cap reached

## First-value milestone
First value is not "the AI answered."

Record first value when BookedRadar successfully handles a real customer opportunity with:
- useful service need
- usable contact path
- clean handoff/evidence
- no critical policy failure

Review the first-value interaction promptly with the customer.

## Critical stop/review events
Pause/review before continuing live pilot traffic when there is:
- serious safety handling failure
- repeated wrong-business/tenant routing
- privacy or cross-tenant data issue
- repeated transfer failure where transfer is in scope
- material CRM/handoff failure that makes the customer believe leads are safely delivered when they are not
- repeated fabricated booking/price/company-policy behavior
- customer requests pause/stop

Do not hide a failure to preserve a sales opportunity.

## Daily internal pilot review
While ACTIVE:
- calls handled vs cap
- time remaining
- useful lead rate
- incomplete calls
- transfers and failures
- knowledge gaps
- CRM/action failures
- customer feedback
- first value achieved?
- configuration correction needed?

## Customer-facing proof review
Show:
- agreed scope
- pilot dates/calls
- opportunities captured
- human escalations
- incomplete outcomes
- recovered opportunities
- confirmed revenue only when trusted evidence exists
- notable customer questions/knowledge gaps
- operational issues/fixes
- recommendation: stop, continue current scope, or consider a separately approved expansion

Never show synthetic/demo events as customer results.

## Recovery / rollback
Before activation, document how the customer restores the pre-pilot call flow.
If BookedRadar is paused:
- do not silently expand or extend the pilot
- prioritize restoring the customer's known-good call path
- preserve evidence/logs needed to understand the incident
- communicate material impact promptly
- resume only after the relevant acceptance scenario passes again

## "Bulletproof" definition
Bulletproof does not mean failures are impossible.
It means:
- failure modes are anticipated
- scope is limited
- problems are observable
- customers are not trapped
- there is a safe fallback
- evidence is preserved
- recovery is rehearsed
- claims remain truthful
