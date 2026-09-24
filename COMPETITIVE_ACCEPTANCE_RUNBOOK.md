# BookedRadar Competitive Pre-Launch Acceptance Runbook

**Launch rule:** Do not activate a paying client until every required test below passes for the production demo tenant or a controlled equivalent. A failed test returns the affected feature to disabled/confirm-only behavior; it does not justify weakening the proven voice/transfer path.

## 1. Baseline voice regression

Call the BookedRadar demo number and complete a normal English service intake.

Pass criteria:
- Greeting begins promptly.
- One question at a time.
- Name, callback, service address, city, service need, urgency and preferred timing are captured or explicitly declined.
- Address confirmation works.
- Final callback confirmation works once.
- CRM/recovery opportunity is created.
- Natural goodbye.
- No transfer or competitive feature changes the basic intake behavior.

## 2. Proven human-transfer regression

During a complete intake say, “I want to speak with someone.”

Pass criteria:
- Assistant says the approved hold phrase before invoking transfer.
- Transfer companion SMS contains safely available caller/business context.
- Caller hears no unexplained silence during the transfer hold.
- Proven REFER fallback rings the receiving phone and completes.
- If any experimental screened/warm path is enabled later and fails, fallback still completes without a hung call.

## 3. Spanish voice

Start the call in Spanish and remain in Spanish.

Pass criteria:
- Assistant naturally follows the caller into Spanish.
- Proper names, phone numbers and addresses are preserved rather than translated.
- Same required intake fields are collected.
- Safety/escalation and human-transfer behavior remain identical to English.
- CRM/recovery record preserves the supplied details.

## 4. Returning-caller continuity

First call: create a normal lead. End the call.  
Second call from the same number: call again with a different current request.

Pass criteria:
- Caller-ID match is treated only as a possible returning-caller hint.
- Assistant naturally verifies identity before using prior context.
- It does not reveal a prior address or private detail before identity confirmation.
- It does not assume the old service address or old problem applies to the new call.
- It can use verified prior context to reduce unnecessary repetition.

## 5. Spam / solicitor screening

Test two calls:

A. Clearly state that you are making an unrelated sales solicitation/robocall.  
B. Make a legitimate but unusual customer inquiry.

Pass criteria:
- A is politely screened and ended.
- B is not screened merely for being unusual, hesitant, accented, incomplete or outside a standard script.
- Spam classification is never based on caller ID alone.

## 6. Knowledge Gap Radar

Ask a business-specific question not present in approved tenant guidance, such as a warranty, financing, exact service-area edge, or policy question.

Pass criteria:
- Assistant does not invent an answer.
- It says the team can follow up.
- The question is recorded in Knowledge Gap Radar.
- The private call-history record shows the knowledge-gap count/question.

## 7. Transcript history

Use a demo call with transcript retention explicitly approved.

Pass criteria:
- Both caller and assistant transcript turns are retained.
- The record is visible only through authenticated tenant-scoped call-history endpoints/dashboard.
- Obvious SSN/payment-number patterns are redacted by the persistence layer.
- Audio recording is not implied or enabled by transcript history.
- Search finds the test call by a transcript term.
- Another tenant cannot retrieve the record.

## 8. RadarProof + call activity

After the voice tests, open the private RadarProof dashboard.

Pass criteria:
- Calls handled increases.
- Human transfer count reflects transfer tests.
- Spam-screened count reflects the spam test.
- Calls-with-transcript count reflects approved transcript calls.
- Knowledge-gap count reflects the unknown-question test.
- Recovery estimates remain labeled separately from confirmed revenue.

## 9. Web chat — live-site acceptance

On bookedradar.com, open the BookedRadar chat widget.

Pass criteria:
- Widget loads only on an approved origin.
- One question at a time.
- English and Spanish both work.
- A service inquiry with usable contact information creates a shared recovery opportunity.
- Subsequent chat turns update the existing opportunity rather than create duplicate opportunities.
- Requesting a human creates the expected human-alert/task.
- Chat does not promise a live appointment in confirm-only mode.
- An unapproved origin receives no chat access.

## 10. Two-way SMS — after A2P/customer messaging approval

Once the demo tenant SMS adapter is enabled and carrier/A2P approval is confirmed:

Pass criteria:
- An approved transactional follow-up is delivered.
- Customer reply attaches to the correct open opportunity.
- Automated pending SMS/email follow-ups are canceled when appropriate after engagement.
- AI response uses business rules and does not invent prices/availability.
- STOP suppresses future automated outreach.
- HELP/START carrier behavior is not overridden incorrectly.
- Tenant credentials/senders cannot bleed across customers.

## 11. In-call requested text — after SMS approval

During a call ask for an approved resource/link by text.

Pass criteria:
- Assistant confirms/uses a usable callback number.
- SMS is sent only through the tenant’s approved adapter.
- Suppressed/opted-out contact does not receive the automated text.
- No marketing or sensitive data is sent through this tool.

## 12. Simple Google Calendar live booking

Use a controlled test calendar and a tenant with:
- policies.bookingMode = live_booking
- commercial.serviceTier = scheduling or scheduling_and_dispatch
- commercial.schedulingApproved = true
- commercial.schedulingAgreementReference populated
- integrations.calendar.type = google_calendar
- tenant-specific OAuth refresh credentials configured

Pass criteria:
- Calendar free/busy is queried; availability is never invented.
- Caller’s preferred window is converted to a concrete RFC3339 search range.
- Busy periods are excluded.
- Returned slot IDs are used exactly.
- Slot is re-checked immediately before insert.
- A slot that becomes busy is not booked.
- Successful insert returns a provider booking ID and closes/reconciles the recovery opportunity correctly.
- Removing credentials or commercial approval returns the tenant to blocked/confirm-only behavior.

## 13. Website legal/source release

Publish the prepared competitive-prelaunch Wix release to the existing site only:
- Site ID: dc96494e-5565-41be-8513-deeeedcf59d7
- Do not create a new site.

Pass criteria:
- Privacy explains optional customer-approved transcript retention, cross-channel voice/SMS/web workflows, tenant-isolated retention and provider tokens.
- Terms distinguish confirm-only, separately approved live booking, and separately scoped full-time scheduling/dispatch.
- /privacy.html and /terms.html are live and readable after release.
- Existing redirects, forms/CRM, robots.txt and sitemap remain intact.

## 14. Final launch decision

Only after all enabled customer-facing features have passed:
- Billing agreement and live Stripe acceptance test complete.
- Customer Quick Start verified.
- First customer tenant passes tenantReadiness().
- Provider-specific phone forwarding instructions supplied.
- Customer performs one acceptance call.
- No feature is advertised as active if its provider/customer gate is still disabled.

**Differentiation to preserve:** BookedRadar is not sold as an AI receptionist. The operating loop is: capture the opportunity across voice/SMS/web → preserve context → recover missed/stale demand → escalate exceptions → learn unanswered business questions → prove outcomes and confirmed revenue separately.
