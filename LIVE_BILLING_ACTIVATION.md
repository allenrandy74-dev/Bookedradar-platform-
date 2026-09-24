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

If any requirement is missing, live billing must fail closed.

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
8. Verify startup refuses to operate as live billing until armed, and that no test/live state is mixed.
9. Verify all live price objects against expected package amounts.
10. Set `BOOKEDRADAR_BILLING_LIVE_ARMED=true`.
11. Deploy.
12. Require startup log `billing.package_prices.startup` to show:
    - mode: live
    - live_armed: true
    - every package standard/founding configured
    - every configured price validated
13. Create one controlled live Checkout Session without completing payment; verify the displayed package, monthly amount, ACH/card option and cancellation return path.
14. Use the first approved customer payment as the first actual settlement acceptance; do not fabricate a live customer charge.

## Standard setup fees

Founding Partner setup fees are waived.

The current package checkout covers the recurring monthly subscription. For non-Founding customers, any standard setup fee is governed by the signed service order and should be invoiced/collected separately until a dedicated one-time setup-fee billing flow is intentionally implemented and tested.

## Cancellation

Default commercial language is month-to-month unless the signed service order states otherwise.

Stripe portal cancellation may end service at the paid period end. BookedRadar preserves cancellation timestamps and prevents delayed events from reactivating a cancelled/replaced subscription.

No abrupt automated call-routing change should be tied directly to a single payment event; service suspension/handoff remains an operational decision governed by the customer agreement.
