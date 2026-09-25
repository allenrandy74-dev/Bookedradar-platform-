# BookedRadar First-Customer Launch Checklist

This checklist defines the minimum gates for accepting a paying customer. A customer is not considered live merely because billing or phone forwarding is enabled.

## A. Core platform — COMPLETE

- [x] Production service healthy.
- [x] Voice greeting/intake acceptance test completed.
- [x] CRM/recovery record created during live call.
- [x] Urgency and preferred timing captured.
- [x] Human transfer requested correctly.
- [x] Transfer companion SMS received with expected information.
- [x] 10-second transfer hold behavior verified.
- [x] SIP REFER transfer rings the receiving phone and completes.
- [x] Transfer cleanup prevents unnecessary response cancellation.
- [x] Automated production test suite passes.
- [x] Warm/screened transfer experiment cannot interfere with proven REFER fallback.

## B. Commercial scope — REQUIRED BEFORE SALE

- [x] Founding Partner pilot baseline defined at $497/month.
- [x] Setup fee waived for approved Founding Partners.
- [x] ACH preferred; card fallback supported.
- [x] Confirm-only scheduling is included in the base pilot.
- [x] Full-time scheduling/dispatch is separated from the base pilot.
- [x] Full-time scheduling/dispatch requires a custom quote and separate approval.
- [x] Customer-facing service agreement draft explicitly reflects the service scope and limitations; final legal review remains required before signature.
- [x] Refund/cancellation/billing effective-date language aligned in the service-order template with the implemented period-end cancellation and billing-state behavior; final legal review remains recommended.

## C. Billing

- [x] Stripe test billing lifecycle implemented.
- [x] Duplicate-subscription protections implemented.
- [x] ACH checkout path tested.
- [x] Card fallback path tested.
- [x] Billing portal/cancellation state handling tested.
- [x] Webhook signature and stale-event protections tested.
- [ ] Live Stripe credentials/payment objects enabled only after final agreement review.
- [ ] One controlled live-payment acceptance test completed before charging a customer.

## D. Customer onboarding

- [x] Quick Start intake defined.
- [x] Tenant draft generation implemented.
- [x] Customer-specific secret isolation required.
- [x] CRM/email/SMS/live-booking adapters cannot be treated as ready without tenant-specific configuration.
- [x] Full-time scheduling discovery requirements documented.
- [x] Final customer-facing Quick Start form verified in Wix (BookedRadar Quick Start, revision 3).
- [x] Customer-facing welcome/onboarding email finalized.
- [ ] Provider-specific phone-forwarding instructions prepared for the first customer's carrier.
- [ ] First customer tenant passes `tenantReadiness()`.
- [ ] First customer completes live acceptance call.

## E. Legal / policy / customer expectations

- [ ] Terms of service reflect actual BookedRadar LLC legal/business details.
- [ ] Privacy policy accurately describes collected call/contact data and connected providers.
- [ ] Customer agreement identifies who is responsible for emergency services and field-service decisions.
- [ ] Agreement states that confirm-only mode does not guarantee an appointment.
- [ ] Agreement states that live scheduling/dispatch requires a separate approved scope.
- [ ] Call recording is disabled unless law/policy/customer configuration supports it.

## F. Communications

- [x] SMS transfer companion proven on a handset.
- [x] Customer-facing transactional email provider acceptance test completed successfully through Resend; synthetic delivery succeeded in production and startup smoke testing was disabled afterward.
- [x] A2P/customer-facing SMS campaign approved/registered before any customer notification SMS is enabled.
- [ ] STOP/HELP/opt-out behavior verified for any customer-facing SMS campaign.

## G. Sales launch

- [x] Initial Southeast Texas prospect list prioritized.
- [x] Business-specific research completed for top prospects.
- [x] Personalized outreach drafts prepared for initial top prospects; nothing sent without approval.
- [ ] Short presentation/one-page explainer finalized.
- [x] Demo flow and competitive acceptance runbook prepared using the isolated demo tenant.
- [x] Package Matrix, Service Scope, deployment-plan statuses, and activation rules prevent sales from representing gated features as active.

## Launch rule

A prospect may be contacted before every operational item is complete, but **no paying customer should be activated for real callers until their own onboarding, provider connections, agreement, billing, and acceptance test have passed**.


## H. Competitive upgrade acceptance — MARKET-FIRST GATE

The competitive upgrade code should be in production before the first client, but **only features included in that client's package must pass live acceptance before activation**. Provider-dependent or premium features may remain disabled and must not be advertised as active until their own acceptance tests pass. This prevents unfinished add-ons from delaying a client who only needs the proven core + recovery service.

### Receptionist parity
- [x] Returning-caller memory implemented with tenant isolation and caller-ID caution.
- [x] Conservative spam/solicitor screening implemented behind tenant controls.
- [x] English/Spanish conversation guidance implemented.
- [x] Searchable private call-history infrastructure implemented.
- [x] Transcript retention requires explicit customer approval; audio recording remains separate/off by default.
- [x] In-call transactional texting capability implemented and hard-gated on an approved tenant SMS adapter.
- [x] Two-way SMS conversation engine implemented and hard-gated on an approved tenant SMS adapter.
- [x] Embeddable web-chat engine implemented with origin allowlisting and shared recovery context.
- [x] Web chat feeds the same recovery/RadarProof opportunity engine rather than a separate inbox.
- [x] Knowledge Gap Radar implemented to record unanswered business-specific questions without guessing.
- [x] RadarProof combines recovery/revenue metrics with call activity.

### Acceptance tests still required
- [x] Normal English voice regression call passes after competitive features are enabled.
- [x] Human transfer regression passes with the proven SMS + hold + REFER path.
- [x] Spanish voice conversation passes with correct intake and no loss of transfer behavior.
- [x] Returning-caller test recognizes prior context only after identity is naturally verified.
- [x] Obvious solicitor/spam test ends safely without screening a legitimate customer.
- [x] Knowledge Gap Radar test records an unknown business-policy question and does not invent an answer.
- [x] Transcript-history test captures both sides of an approved demo call and remains tenant-isolated/searchable.
- [ ] BookedRadar web-chat widget passes a live website-origin test and creates/updates a recovery opportunity.
- [ ] Web-chat human-request path creates the expected human alert/task.
- [ ] Two-way SMS acceptance test passes after carrier/A2P and tenant SMS activation.
- [ ] In-call requested-text test passes after carrier/A2P and tenant SMS activation.
- [ ] RadarProof displays call counts, transfer counts, screened calls, knowledge gaps and recovery/revenue measures from test activity.
- [ ] Simple live-booking capability is acceptance-tested for any customer sold live booking; otherwise the customer remains confirm-only.
- [x] Customer-facing package/legal sync is installed on the existing Wix site; Package Matrix, Service Order, onboarding docs, and deployment gates describe retention, messaging and scheduling activation boundaries. Static editorless source should still be consolidated in a future source release.

### Differentiation rule

Competitive parity features are not the primary sales promise. The product story remains:

**Answer the opportunity → preserve the context across voice/SMS/web → recover what would otherwise be lost → prove the recovered value.**

Knowledge Gap Radar should also improve each tenant over time by showing what real callers ask that the approved business knowledge cannot yet answer.


## I. Market-first launch rule

**Launch-critical for the first Founding Partner using the core + recovery package:**
- Proven English voice intake and human-transfer regression.
- CRM/recovery capture and tenant isolation.
- Returning-caller/privacy behavior if caller memory is enabled.
- Spam screening if enabled.
- Knowledge Gap Radar if enabled.
- RadarProof and Owner Brief reporting.
- Accurate agreement/privacy language for the features actually enabled.
- Billing and customer-specific acceptance call.

**Do not delay launch solely for these when they are not sold/enabled for the first customer:**
- Customer-facing two-way SMS / in-call texting while A2P or tenant messaging is not ready.
- Live Google Calendar booking when the customer is using confirm-only scheduling.
- Full-time scheduling/dispatch.
- Spoken screened/warm transfer while the proven REFER fallback is the enabled transfer method.
- Automated membership-renewal email or No-Show Guard messaging when those features are disabled.

The rule is simple: **never sell or enable an unaccepted feature, but do not let an optional disabled feature block a customer whose purchased scope is fully accepted.**


## J. Verified production evidence — September 24, 2026

- [x] Latest production image is live on Render.
- [x] Full automated build gate passed: **193 tests passed, 0 failed**.
- [x] Demo RadarRecover tenant startup readiness: **READY**, zero blockers, zero warnings.
- [x] Configured demo adapters: email, human task, human alert.
- [x] Booking adapter remains **ConfirmOnlyBookingAdapter** for market-first launch.
- [x] Proven SIP REFER transfer fallback reports ready; screened/warm transfer remains intentionally disabled.
- [x] Production Resend email smoke test succeeded.
- [x] Production Wix CRM contact-create permission smoke test succeeded.
- [x] Production Wix CRM follow-up task-create permission smoke test succeeded.
- [x] Synthetic CRM contact/task created by verification were cleaned up after the test.
- [x] End-to-end smoke path preserved idempotency and did not duplicate the existing synthetic event.
- [x] Smoke-on-startup environment switches were restored to false after verification.
- [x] Package profiles, entitlement/activation separation, pricing, deployment manifest and package-aware billing code are implemented.
- [x] Test and live billing state are separated; live billing requires an explicit second arm and rejects wrong-mode Stripe objects/events.
- [x] Live billing requires a complete verified Stripe price catalog for all published standard and Founding package prices before it can start.
- [x] Customer Service Order template created with package, activation, scheduling, messaging, retention, billing/cancellation and acceptance fields.
- [x] Existing Wix site has enabled BookedRadar Web Chat and Package & Legal Sync embeds.

## K. Verified production evidence — September 25, 2026

- [x] Production acceptance suite ran **198 tests**.
- [x] Acceptance audit reviewed six recent QA calls without counting them as customer activity: three produced lead summaries, two were correctly screened as spam, and one intentionally recorded a business-policy knowledge gap.
- [x] The Knowledge Gap case was traced to an unanswered compressor labor-warranty question; BookedRadar did not invent a warranty answer.
- [x] Normal English voice, Spanish conversation, returning-caller privacy, solicitor/spam screening, Knowledge Gap behavior and approved transcript-history scenarios passed.
- [x] Human-transfer regression remains proven with companion SMS, 10-second hold and SIP REFER fallback.
- [x] Revenue Leak Audit has no real submissions at this checkpoint.
- [x] Wix CRM internal QA backlog was reconciled: 16 verified test-only ACTION_NEEDED tasks were completed; customer ACTION_NEEDED queue is 0.
- [x] Wix traffic reporting path was revalidated; 2026-09-25 through 10:00 CT reports 0 sessions, 0 visitors and 0 page views, matching the prior-day same-time window.
- [x] Duplicate legacy homepage path consolidated with a permanent Wix SEO redirect from `/index.html` to `/`.
- [x] Clean production deployment `e8c7b48` is live; tenant readiness is READY with zero blockers/warnings and no error-level logs after startup.
- [x] Stripe confirmed the BookedRadar LLC account can process live payments and a payout bank account is attached.
- [ ] Live Stripe catalog/webhook/portal/Render price mappings remain intentionally disarmed until every published package price is created and verified.
- [ ] Search Console direct verification is temporarily unavailable through the current GSC connector; Wix redirect correction is complete, but Google recrawl resolution is not yet claimed.

### External activation gates remaining

- [ ] Connect the BookedRadar Stripe account to the available Stripe integration or complete equivalent account-level setup.
- [ ] Create/verify live Stripe standard + Founding recurring prices for RadarAnswer, RadarRecover, RadarGrow and RadarSchedule.
- [ ] Configure live Stripe webhook / Billing Portal / Render live billing variables with live arm initially false.
- [ ] Run one controlled live Checkout display test, then use the first approved customer payment as settlement acceptance.
- [ ] Run the short post-upgrade live voice acceptance sequence: normal English, transfer regression, Spanish, returning caller, solicitor/spam, Knowledge Gap, transcript history.
- [ ] If the first customer uses web chat, perform one browser-origin acceptance test before enabling it for that customer.
- [ ] If the first customer uses customer-facing SMS, complete tenant/A2P/STOP/HELP acceptance before enabling it.
- [ ] If the first customer purchases RadarSchedule, connect their approved calendar and run live-booking acceptance before activation.
- [ ] Obtain qualified legal review of the customer-facing agreement/terms before broad commercial rollout; use the current template as the operational draft meanwhile.
