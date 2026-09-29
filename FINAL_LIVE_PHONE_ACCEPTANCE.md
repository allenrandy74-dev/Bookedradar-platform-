# BookedRadar Final Live Phone Acceptance — Market Launch

## Acceptance recorded September 25, 2026

Randy accepted the completed call testing in conversation at approximately 12:31 PM America/Chicago. His reported remaining behavior was that some transfers reached the receiving person's voicemail. This records owner acceptance of the existing call experience; it does not invent new call IDs, new provider evidence, or a fresh call on every later build.

The accepted path remains companion SMS, approximately 10-second hold, then SIP REFER. If the recipient does not answer or declines, their carrier/voicemail may answer. The platform cannot guarantee a human answer or reclaim the call after REFER. Screened/warm transfer stays disabled. Each customer must accept this behavior and verify their own routing and voicemail greeting before go-live.

The scenarios below remain the reusable regression procedure.

**Goal:** close the remaining human-in-the-loop acceptance items without changing the proven core call/transfer path.

## Call 1 — English intake + transfer regression

Say naturally:

1. “Hi, my air conditioner stopped cooling this afternoon.”
2. Give a test name.
3. Give a test service address and city.
4. Say: “It’s pretty urgent. We have small children in the house.”
5. Give a preferred time.
6. When prompted, confirm the callback number.
7. Say: “I want to speak with someone.”

**Pass**
- Prompt greeting.
- One question at a time.
- Does not re-ask information already supplied.
- Exact address is confirmed.
- Urgency and timing are preserved.
- Transfer companion summary is sent.
- Caller hears the transfer hold message.
- Approximately 10-second hold.
- Receiving phone rings.
- SIP REFER completes.
- CRM/recovery record is created.
- No unexplained silence/hang.

## Call 2 — Spanish

Begin and remain in Spanish:

“Hola, mi aire acondicionado no está enfriando y necesito ayuda.”

Provide a test name/address/urgency/timing in Spanish.

**Pass**
- BookedRadar continues naturally in Spanish.
- Names, phone numbers and address are preserved accurately rather than translated.
- Same intake quality as English.
- It can still perform human escalation if requested.
- CRM/recovery record contains the correct facts.

## Call 3 — Returning-caller privacy

Use the same calling number as Call 1.

Start:

“Hi, I’m calling about a different problem today.”

**Pass**
- Caller-ID context is treated as a possible match, not identity proof.
- BookedRadar verifies who is calling naturally before using prior personal context.
- It does not reveal the previous service address/problem before identity confirmation.
- It does not assume the old address/current issue applies.
- Once identity is confirmed, it may use verified prior context to reduce repetition.

## Call 4 — Spam/solicitor screening

First test, clearly say:

“Hi, I’m with a marketing company and I’m calling to sell your business advertising services.”

**Pass**
- Politely identifies it as unrelated solicitation and ends the call.
- Does not create a normal customer-service lead.

Then make a separate unusual-but-legitimate call:

“Hi, I manage a rental property and I’m not sure what kind of HVAC service I need. Can someone help me figure out the next step?”

**Pass**
- This call is **not** screened as spam.
- It proceeds through normal intake/escalation.

## Call 5 — Knowledge Gap Radar

Ask a business-specific question that is intentionally not in the approved demo knowledge, for example:

“Exactly how long is your labor warranty on a compressor replacement?”

**Pass**
- BookedRadar does not invent an answer.
- It tells the caller the team can follow up.
- Knowledge Gap Radar records the question.
- The private call-history record shows the knowledge-gap signal.

## Call 6 — Transcript history

Use an approved demo call with transcript retention enabled.

Have a short normal conversation containing a unique harmless phrase:

“Please note that my blue garden gate is on the left side.”

**Pass**
- Caller and assistant transcript turns are retained.
- The unique phrase is searchable in Call History.
- Record remains tenant scoped.
- Audio recording is not implied/enabled merely because transcript history is enabled.

## After the calls — production evidence to inspect

For each call, check:
- production call lifecycle;
- captured lead;
- recovery opportunity;
- CRM/contact/task outcome;
- transfer events where applicable;
- call-history record;
- transcript turns;
- Knowledge Gap Radar;
- spam-ended flag;
- RadarProof / Owner Brief counts.

## Final go/no-go

**GO** when:
- Calls 1–6 pass for the features enabled on the first-market demo;
- no regression appears in transfer or intake;
- no cross-tenant/privacy issue appears;
- no feature invents business facts.

If one optional feature fails, gate only that optional feature and preserve the accepted core path unless the failure affects the core call experience.

Do not re-enable screened/warm spoken transfer solely to pass parity testing. The proven SMS-context + hold + REFER fallback remains the accepted transfer method until a replacement path is separately proven.

## Current-build revalidation — September 29, 2026

Historical September 25 acceptance remains valid evidence for the previously tested build, but it is not automatically treated as acceptance of every later production image.

- Render production is live on commit `cffd72019be7447e56692b70a2fb8cabae03de17`.
- GitHub `main` is ahead of that production image by two commits that change only concurrency/private-test code and documentation; they do not change the customer-facing production voice path. Production was intentionally not redeployed merely to match `main`.
- A September 29 call to `demo-plumbing` from a masked caller ending in `8573` was confirmed by Randy to be his own test call, not prospect/client activity.
- That call reached first greeting audio about 1.8 seconds after acceptance, completed greeting playback, and ended roughly 10 seconds after call control began. It did not complete intake or transfer and therefore does **not** close the current-build acceptance gate.
- No additional production call activity was observed after that owner test through the September 29 re-check.
- The separate private voice lab is isolated from production data. At the re-check it reported `voiceEnabled: false`; CRM, email, SMS, dispatch and billing were disabled, and the synthetic tenants were intentionally blocked from normal production readiness.

### Remaining current-build gate

Before treating the current production image as freshly accepted, complete one controlled owner call on the current production build covering:

1. normal intake;
2. exact address confirmation and spelling clarification when needed;
3. urgency and preferred timing;
4. natural closing;
5. transfer companion SMS;
6. approximately 10-second delay/hold;
7. SIP REFER ring-through; and
8. usable two-way audio after transfer.

Until that call is observed and verified, report the September 25 acceptance as historical acceptance and the September 29 greeting-only call as owner QA evidence, not external customer activity and not full current-build acceptance.
