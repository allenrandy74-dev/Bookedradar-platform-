# Stripe test billing integration

This release accepts only Stripe test keys and test events. It does not activate,
interrupt or cancel live voice service. Live charging requires a separately reviewed
release and customer agreement. No customer email is set by test enrollment.

## Configuration

Set `BOOKEDRADAR_BILLING_ENABLED=true`, `STRIPE_SECRET_KEY` (test only),
`STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, `STRIPE_PORTAL_CONFIGURATION`,
`BILLING_PUBLIC_BASE_URL` (HTTPS origin), `BILLING_STATE_FILE=/app/data/billing-test-state.json`,
and a random `BOOKEDRADAR_BILLING_ADMIN_TOKEN` of at least 32 characters.
Keep credentials in Render environment variables, never the repository or reports.
Leave billing disabled if configuration is incomplete.

Webhook: `POST /stripe/webhook`, signature verified against the unmodified body.
Subscribe to the event names exported by `src/billing/service.js`. The SDK uses
Stripe API version 2026-08-26.dahlia. Do not reuse the OpenAI webhook secret.

## Operator API

All `/api/v1/billing` routes require the dedicated billing bearer token. They are
operator endpoints; never expose the token in a customer browser or public website.

- `POST /accounts`: `{tenantId, qualified: true, agreementAccepted: true}`. Tenant
  must already exist. Operator explicitly attests eligibility and signed agreement.
  Test-clock customers can add `testClock`. Five slots maximum; repeat requests
  return the existing account. Cancelled slots are not reused.
- `POST /accounts/:tenantId/checkout`: defaults to ACH. `{method: "card"}` creates
  the explicit fallback and expires any open ACH session. Only one monthly $497
  line item, no setup fee. Existing subscriptions block another Checkout.
- `GET /accounts/:tenantId`: persisted test billing state and payment-attention flag.
- `POST /accounts/:tenantId/portal`: customer-bound Stripe-hosted portal session.

Checkout return pages do not grant access. Webhooks retrieve the current Stripe
subscription and invoice before updating state, so old event delivery cannot undo
newer Stripe changes. An unsettled ACH invoice remains `payment_pending` even if
Stripe calls the subscription active. A paid $497 invoice makes billing `active`.
Failed renewals become `past_due` with `needsPaymentAttention`; no automatic voice
suspension. Scheduled cancellation stays active through its paid period. Completed
cancellation becomes `cancelled`.

The state file stores Stripe object IDs, qualification, billing status and processed
event IDs, not card/bank data or raw webhook bodies. Atomic writes and a serialized
queue provide single-instance idempotency. A failed processing attempt is not marked
complete, allowing Stripe retries. Multiple app instances require a transactional
database before deployment. No automated dunning email is sent by this release.

## Validation

`npm test` includes signed raw-body verification, authorization, live-mode rejection,
qualification/slot enforcement, duplicate Checkout prevention, delayed ACH settlement,
failed renewal, cancellation, stale-event handling and retry after failed processing.
Stripe sandbox lifecycle results must be recorded separately from these local tests.
