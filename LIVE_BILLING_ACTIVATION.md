# BookedRadar Live Billing Activation

Live billing is implemented but must remain **disarmed** until the Stripe live account has the complete package catalog and the checks below pass.

## Safety model

Production charging requires all of the following at the same time:

- `BOOKEDRADAR_BILLING_ENABLED=true`
- `BOOKEDRADAR_BILLING_MODE=live`
- `BOOKEDRADAR_BILLING_LIVE_ARMED=true`
- a live Stripe secret or restricted key
- a live webhook signing secret
- a live Billing Portal configuration
- all published standard + Founding package price IDs
- valid HTTPS billing return URL
- billing admin token of at least 32 characters

If any requirement is missing, live billing must fail closed. A disarmed live configuration may perform read-only price validation, but its billing account API and webhook processing return 503. Billing startup failure is isolated from voice/CRM startup.

Test and live billing use separate state files and reject Stripe objects/events from the other mode.

## Stripe products / recurring prices

Create recurring monthly USD prices for:

| Package | Standard | Founding |
| --- | ---: | ---: |
| RadarAnswer | $149 | $149 |
| RadarRecover | $497 | $397 |
| RadarGrow | $697 | $597 |
| RadarSchedule | $897 | $797 |

RadarAnswer standard and Founding may reference the same $149 monthly Stripe Price ID if desired.

Recommended Stripe product names:
- BookedRadar — RadarAnswer
- BookedRadar — RadarRecover
- BookedRadar — RadarGrow
- BookedRadar — RadarSchedule

Do not create a generic “unlimited usage” promise in Stripe product copy.

## Required Render variables for live package billing

- `BOOKEDRADAR_BILLING_ENABLED=true`
- `BOOKEDRADAR_BILLING_MODE=live`
- `BOOKEDRADAR_BILLING_LIVE_ARMED=false` **until final arm**
- `STRIPE_SECRET_KEY=sk_live_... or rk_live_...`
- `STRIPE_WEBHOOK_SECRET=whsec_...`
- `STRIPE_PORTAL_CONFIGURATION=bpc_...`
- `BILLING_PUBLIC_BASE_URL=https://bookedradar-platform.onrender.com` or the final approved BookedRadar billing hostname
- `BOOKEDRADAR_BILLING_ADMIN_TOKEN=<separate random 32+ character secret>`

Package prices:
- `STRIPE_PRICE_ANSWER_STANDARD`
- `STRIPE_PRICE_ANSWER_FOUNDING`
- `STRIPE_PRICE_RECOVER_STANDARD`
- `STRIPE_PRICE_RECOVER_FOUNDING`
- `STRIPE_PRICE_GROW_STANDARD`
- `STRIPE_PRICE_GROW_FOUNDING`
- `STRIPE_PRICE_SCHEDULE_STANDARD`
- `STRIPE_PRICE_SCHEDULE_FOUNDING`

Optional:
- `BILLING_STATE_FILE=/app/data/billing-live-state.json`

If `BILLING_STATE_FILE` is omitted, the server selects a separate live state filename automatically.

## Webhook

Stripe should send the supported billing events to:

`https://bookedradar-platform.onrender.com/stripe/webhook`

Supported events include:
- checkout completion / asynchronous bank-payment results
- subscription create/update/delete
- invoice paid
- invoice payment failed / action required / updated

The application verifies the Stripe signature and then verifies that the subscription:
- belongs to the BookedRadar Stripe customer,
- has the expected tenant metadata,
- is in the expected live/test mode,
- uses the selected package price,
- and has quantity 1.

Delayed events from retired subscriptions cannot take ownership of the active billing account.

## Activation sequence

1. Connect the BookedRadar Stripe account.
2. Create/verify the four Stripe products.
3. Create/verify all eight standard/Founding recurring price mappings.
4. Configure the Billing Portal cancellation/payment-method behavior.
5. Add the live webhook endpoint and signing secret.
6. Add the live Render variables with `BOOKEDRADAR_BILLING_LIVE_ARMED=false`.
7. Deploy.
8. Verify startup validates the live catalog while disarmed; billing account operations and webhook processing must return 503, and no test/live state is mixed.
9. Verify all live price objects against expected package amounts.
10. Only after separate explicit authorization, set `BOOKEDRADAR_BILLING_LIVE_ARMED=true`.
11. Deploy.
12. Require startup log `billing.package_prices.startup` to show:
    - mode: live
    - live_armed: true
    - every package standard/founding configured
    - every configured price validated
13. Create one controlled live Checkout Session without completing payment; verify the displayed package, monthly amount, ACH/card option and cancellation return path. If activation is not authorized, a separately authorized Stripe-only controlled session may be used without changing the application's arm flag. Do not enroll a fabricated customer agreement or bypass the application arm gate.
14. Use the first approved customer payment as the first actual settlement acceptance; do not fabricate a live customer charge.

## Standard setup fees

Founding Partner setup fees are waived.

The current package checkout covers the recurring monthly subscription. For non-Founding customers, any standard setup fee is governed by the signed service order and should be invoiced/collected separately until a dedicated one-time setup-fee billing flow is intentionally implemented and tested.

## Cancellation

Default commercial language is month-to-month unless the signed service order states otherwise.

Stripe portal cancellation may end service at the paid period end. BookedRadar preserves cancellation timestamps and prevents delayed events from reactivating a cancelled/replaced subscription.

No abrupt automated call-routing change should be tied directly to a single payment event; service suspension/handoff remains an operational decision governed by the customer agreement.

## Catalog prepared September 25, 2026

Existing Stripe account: `acct_1UJDp1CIdeSd220W` (BookedRadar LLC).

| Render variable | Live monthly price ID | USD |
| --- | --- | ---: |
| STRIPE_PRICE_ANSWER_STANDARD | price_1UJXVFCIdeSd220WvY9Sx350 | 149 |
| STRIPE_PRICE_ANSWER_FOUNDING | price_1UJbPkCIdeSd220Wj0xcscIf | 149 |
| STRIPE_PRICE_RECOVER_STANDARD | price_1UJbN2CIdeSd220WKvuwzbp9 | 497 |
| STRIPE_PRICE_RECOVER_FOUNDING | price_1UJbOKCIdeSd220WvAsOgu2x | 397 |
| STRIPE_PRICE_GROW_STANDARD | price_1UJbNZCIdeSd220WdDWWmMLQ | 697 |
| STRIPE_PRICE_GROW_FOUNDING | price_1UJbOsCIdeSd220WFRg6hPCw | 597 |
| STRIPE_PRICE_SCHEDULE_STANDARD | price_1UJbNsCIdeSd220WCOcMXtOM | 897 |
| STRIPE_PRICE_SCHEDULE_FOUNDING | price_1UJbPKCIdeSd220WgGLub5pE | 797 |

- Live portal: `bpc_1UJEXHCIdeSd220WLQkERIpk`; payment method updates enabled; cancellation at paid-period end; plan/quantity changes disabled; return URL `https://bookedradar-platform.onrender.com/billing/return`.
- Live webhook: `we_1UJbTvCIdeSd220Wm5OKE1fx`; exact 10 events in `BILLING_EVENTS`; API version `2026-08-26.dahlia`.
- Do not replace test mappings with these live IDs until the live key, webhook secret, mode and portal configuration can be switched together. Preserve test state separately.
- Approved restricted production API key created and installed: Customers, Subscriptions, Checkout Sessions, Customer Portal write; Prices, Products, Invoices read. No payout/transfer permissions. Secret values are not stored in this document.
- Live credentials, portal, all eight mappings, and mode were saved to the existing Render service. `BOOKEDRADAR_BILLING_LIVE_ARMED=false`; separate live state: `/app/data/billing-live-state.json`.
- Production deployment `dep-daradoad0e5s73e031ig` startup at 2026-09-25T16:53:15Z validated all eight mappings with mode live, live_armed false, and disarmed true.
- Authenticated billing account API returned HTTP 503 `live_billing_not_armed`. Voice remained enabled with one tenant and the existing transfer fallback configuration.
- Live Portal configuration was retrieved successfully with the restricted production key; active, live, payment-method updates enabled, cancellation at period end, plan changes disabled.
- One authorized Stripe-only inspection Checkout Session used RadarRecover founding at USD 397/month with card and US bank account available. No payment or customer information was entered. The Back link returned to the cancellation page correctly.
- Inspection session: `cs_live_a1puNDSXQaxH3daPSKQQYYFlb0jm67lTdFuXzvz6PsOTaUREqRPFWTWiWc`. It was explicitly expired after inspection; no customer, subscription, or payment intent was created.
- Live charging remains disarmed. First real payment, settlement, and actual paid-event webhook acceptance require separate customer-payment authorization.
