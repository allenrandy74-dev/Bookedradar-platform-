# BookedRadar Market Readiness Certificate — 2026-09-24

## Decision

**Market-first RadarRecover technical/operational readiness: 98% confidence, subject to the external activation gates below.**

This is not a claim that every optional BookedRadar feature is active. It means the core product we intend to sell first—RadarRecover with confirm-only scheduling and provider-gated optional channels—has reached a level where the remaining risk is concentrated in a small number of explicit external/account and live-human acceptance steps rather than unfinished core architecture.

## Production evidence

- Production service: `bookedradar-platform`
- Production host: `https://bookedradar-platform.onrender.com`
- Latest verified production build: commit `897ca54e9ef4b3174a6bb972589cb6fb88d6c279`
- Automated validation: **193 passed / 0 failed**
- Demo tenant: **READY**
- Readiness blockers: **0**
- Readiness warnings: **0**
- Demo package: **RadarRecover**
- Booking mode: **confirm-only**
- Configured production adapters: email, human task, human alert
- Proven transfer strategy: SIP REFER fallback
- Screened/warm transfer: intentionally disabled
- Transfer fallback readiness: **true**

## Provider verification

### Email
Production Resend synthetic delivery succeeded.

### CRM
Production Wix CRM permission test successfully:
- created a synthetic contact,
- created a linked follow-up task,
- then removed both synthetic records after verification.

### Recovery / idempotency
The synthetic end-to-end smoke path recognized its prior event and did not create a duplicate opportunity/action set.

### Website
The existing BookedRadar Wix site contains:
- enabled BookedRadar Web Chat embed;
- enabled BookedRadar Package & Legal Sync embed.

The sync layer updates the market-facing Founding Partner price and current transcript/scheduling scope language in the browser without creating a replacement Wix site.

## Product packaging

### RadarAnswer
$149/month.

Outcome: **Answer the opportunity.**

### RadarRecover
$497/month standard; **$397/month Founding Partner**.

Outcome: **Recover the opportunity.**

This is the recommended first-market package.

### RadarGrow
$697/month standard; $597/month Founding Partner.

Outcome: **Grow and retain the customer.**

### RadarSchedule
$897/month standard; $797/month Founding Partner.

Outcome: **Book the work.**

Every RadarSchedule tenant includes RadarGrow entitlements, but live calendar writing remains separately gated.

### RadarDispatch
Custom scope.

Outcome: **Optimize the field operation.**

## Package integrity

The platform now distinguishes:
- **ENTITLED** — purchased/included in the package;
- **ACTIVE** — configured and accepted for the tenant;
- **GATED** — included but not yet authorized/configured/accepted;
- **NOT INCLUDED** — outside the purchased package.

A higher package includes the lower-tier package capabilities. Provider-dependent or consent-dependent features fail closed.

## Operational controls verified

- Tenant-specific configuration and secrets prefix.
- Caller-memory tenant isolation.
- CRM credential isolation.
- Email/provider isolation.
- Confirm-only default scheduling.
- Commercial live-booking approval gate.
- Transcript-retention approval gate.
- Web-chat approved-origin gate.
- SMS adapter/provider gate.
- Knowledge Gap Radar instead of invented business-policy answers.
- Estimated revenue kept distinct from confirmed revenue.
- Duplicate-event protection.
- Billing duplicate-subscription and stale-event protections.
- Historical Docker preload removed so older source can no longer overwrite current tested modules.

## Billing readiness

### Test billing
Existing test billing remains operational and isolated.

### Live billing architecture
Implemented and tested, but **not armed**.

Live billing now requires:
1. `BOOKEDRADAR_BILLING_MODE=live`
2. `BOOKEDRADAR_BILLING_LIVE_ARMED=true`
3. a live Stripe key
4. a live webhook secret
5. a live Billing Portal configuration
6. complete standard and Founding package price mappings
7. live Stripe price-object verification
8. separate live billing state

Test Stripe objects/events are rejected in live mode, and live Stripe objects/events are rejected in test mode.

### Current external Stripe status
The currently connected production environment is intentionally still using test billing. Current non-secret startup evidence showed only the existing RadarRecover standard test price configured. Live package prices have not yet been created/mapped.

## Customer-facing operating documents

Prepared:
- `PACKAGE_MATRIX.md`
- `SERVICE_SCOPE_AND_PRICING.md`
- `CUSTOMER_ONBOARDING.md`
- `ONBOARDING_QUICK_START.md`
- `CLIENT_SERVICE_ORDER_TEMPLATE.md`
- `LIVE_BILLING_ACTIVATION.md`
- `COMPETITIVE_ACCEPTANCE_RUNBOOK.md`
- `FIRST_CLIENT_LAUNCH_CHECKLIST.md`

## What is ready to sell now

We can confidently **prospect, demo, quote, and onboard toward activation** for RadarAnswer and RadarRecover.

We should describe optional gated capabilities as **included once activated**, not as already active.

We should not begin handling a paying customer's normal callers until:
- the customer-specific tenant is configured,
- that tenant passes readiness,
- the package/service order is accepted,
- the selected billing path is ready,
- the customer completes the applicable acceptance call.

## Remaining external gates — final ~2%

### 1. Stripe live package setup
Connect BookedRadar's Stripe account and create/map/verify live package prices. Run a controlled Checkout display test before the first customer payment.

### 2. Short live post-upgrade voice suite
Using the demo number, verify:
- normal English intake;
- human-transfer regression;
- Spanish intake;
- returning-caller privacy behavior;
- obvious solicitor screening vs legitimate unusual caller;
- Knowledge Gap Radar;
- transcript history on an approved demo call.

These require an actual telephone participant and cannot be fully replaced by automated tests.

### 3. Feature-specific acceptance only when sold
- Customer-facing SMS: A2P/provider + STOP/HELP + live acceptance.
- Web chat: browser-origin acceptance for the customer's site.
- RadarSchedule: customer calendar + booking acceptance.
- RadarDispatch: custom discovery/integration/acceptance.

### 4. Legal review
The operational service-order/terms structure is internally aligned with the implemented controls. Qualified counsel review remains recommended before broad commercial rollout.

## Launch posture

**Do not add more major runtime features before first-market acceptance.**

The highest-value next work is:
1. close live Stripe setup;
2. run the short live voice suite;
3. prepare the first RadarRecover Founding Partner tenant;
4. complete their acceptance call;
5. begin service;
6. use real customer usage/cost data to refine fair-use limits and future package pricing.

## Internal standard

**Every BookedRadar feature should earn money, save labor, protect revenue, or strengthen the customer's relationship with their customers.**

And every capability should be sold only at the level it has actually been accepted for the specific tenant.
