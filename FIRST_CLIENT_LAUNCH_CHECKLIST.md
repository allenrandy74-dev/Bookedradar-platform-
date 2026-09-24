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
- [ ] Refund/cancellation/billing effective-date language reviewed for consistency with Stripe behavior.

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
- [ ] Customer-facing transactional email delivery acceptance test completed.
- [ ] A2P/customer-facing SMS status approved before marketing or customer notification SMS is enabled.
- [ ] STOP/HELP/opt-out behavior verified for any customer-facing SMS campaign.

## G. Sales launch

- [ ] Initial Southeast Texas prospect list prioritized.
- [ ] Business-specific research completed for top prospects.
- [ ] Outreach email customized to each top prospect.
- [ ] Short presentation/one-page explainer finalized.
- [ ] Demo flow prepared using a safe test tenant.
- [ ] Sales promise checklist reviewed so outreach does not promise unapproved live scheduling features.

## Launch rule

A prospect may be contacted before every operational item is complete, but **no paying customer should be activated for real callers until their own onboarding, provider connections, agreement, billing, and acceptance test have passed**.


## H. Competitive upgrade acceptance — REQUIRED BEFORE FIRST CLIENT

BookedRadar will not activate the first paying client until this section has passed.

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
- [ ] Normal English voice regression call passes after competitive features are enabled.
- [ ] Human transfer regression passes with the proven SMS + hold + REFER path.
- [ ] Spanish voice conversation passes with correct intake and no loss of transfer behavior.
- [ ] Returning-caller test recognizes prior context only after identity is naturally verified.
- [ ] Obvious solicitor/spam test ends safely without screening a legitimate customer.
- [ ] Knowledge Gap Radar test records an unknown business-policy question and does not invent an answer.
- [ ] Transcript-history test captures both sides of an approved demo call and remains tenant-isolated/searchable.
- [ ] BookedRadar web-chat widget passes a live website-origin test and creates/updates a recovery opportunity.
- [ ] Web-chat human-request path creates the expected human alert/task.
- [ ] Two-way SMS acceptance test passes after carrier/A2P and tenant SMS activation.
- [ ] In-call requested-text test passes after carrier/A2P and tenant SMS activation.
- [ ] RadarProof displays call counts, transfer counts, screened calls, knowledge gaps and recovery/revenue measures from test activity.
- [ ] Simple live-booking capability is acceptance-tested for any customer sold live booking; otherwise the customer remains confirm-only.
- [ ] Terms/privacy/onboarding copy accurately describes the enabled retention, messaging and scheduling features.

### Differentiation rule

Competitive parity features are not the primary sales promise. The product story remains:

**Answer the opportunity → preserve the context across voice/SMS/web → recover what would otherwise be lost → prove the recovered value.**

Knowledge Gap Radar should also improve each tenant over time by showing what real callers ask that the approved business knowledge cannot yet answer.
