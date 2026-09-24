# BookedRadar Stripe sandbox validation — September 24, 2026

Scope: existing BookedRadar LLC Stripe account and existing BookedRadar Render service.
All Stripe operations used test credentials, synthetic payment methods and the demo
HVAC tenant. No live customer invoice, live charge or real bank debit was created.
Test billing is isolated from telephone service and rejects live keys and events.

## Verified scenarios

| Scenario | Observed result |
| --- | --- |
| Hosted ACH Checkout | $497 USD monthly pilot, no setup-fee line item; Stripe-hosted test bank verification |
| Subscription and first invoice | Created in Stripe test mode; invoice amount $497 |
| ACH verification and settlement | BookedRadar stayed payment_pending while unpaid; changed to active only after paid invoice |
| Webhook delivery | Stripe events reached the deployed signed endpoint and persisted application billing state |
| Portal | Correct subscription, invoice history, payment methods and cancellation controls |
| Payment-method update | Added synthetic decline card and then successful card through hosted portal |
| Failed monthly renewal | Test clock advanced one month; declined payment produced past_due and needsPaymentAttention |
| Service isolation | liveServiceAffected remained false; no billing code changes voice routing |
| Payment recovery | Test retry paid $497 with replacement card; BookedRadar returned to active |
| Duplicate webhook | Signed replay of earlier paid event returned duplicate=true and did not clear past_due |
| Unauthorized API | Missing billing token returned HTTP 401 |
| Invalid webhook signature | Returned HTTP 400 |
| Scheduled cancellation | Portal cancellation kept billing active through the paid period and recorded its end timestamp |
| Cancellation completed | Advancing the Stripe test clock beyond the period end changed BookedRadar to cancelled |
| Live-mode event rejection | A signed synthetic live-mode event returned HTTP 400 |
| Hosted card fallback | A second $497 Checkout completed with a synthetic card, paid its invoice and activated test billing |
| Subscription restart | Cancelled subscription was retired; the new subscription became the sole billing record |

## Test object references

- Stripe account: acct_1UJDp1CIdeSd220W
- Product: prod_VJrccPUMivXTuB
- Monthly price: price_1UJDtECIdeSd220WF2JzyACn
- Customer: cus_VJsVd91cxdfyrm
- Initial subscription: sub_1UJEmNCIdeSd220WvJ3WlBKd
- Initial invoice: in_1UJEmLCIdeSd220Wy2Ky7xxr
- Renewal invoice: in_1UJEofCIdeSd220W2nWEqMIk
- Card fallback subscription: sub_1UJEulCIdeSd220WxbjmWuYY
- Card fallback invoice: in_1UJEukCIdeSd220WlprmXddA
- Test clock: clock_1UJEkUCIdeSd220WJooAqtDn
- Webhook endpoint: we_1UJEisCIdeSd220WP0UcLYMD

## Corrections found during end-to-end testing

1. An ACH-only Checkout session restricts subscription payment methods. The webhook
   now enables both ACH and cards on the owned test subscription so portal card
   changes can fund subsequent invoices.
2. Stripe's portal can schedule cancellation with cancel_at while
   cancel_at_period_end is false. BookedRadar now recognizes the explicit timestamp.
3. A completed Checkout no longer blocks restarting an already cancelled
   subscription. Retired subscription IDs prevent old events taking ownership again.

Each correction has a regression test. The complete local test suite passes 131
checks. The Docker preload path was also tested with the initial integration, and
Render runs syntax checks and the full test suite for each deployment.

## Remaining boundary before live billing

The app deliberately rejects live Stripe credentials. Customer qualification,
agreement acceptance and the first-five waiver are enforced only in this isolated
test workflow. Live billing activation, customer-facing access/identity controls,
operator alert delivery and the service suspension/cure policy require a separate
launch review. The app currently flags failed payments for an operator; it does not
send its own dunning emails or suspend phone service. No additional Randy identity
verification was required for these sandbox tests.

## Deployment and final state

Application code deployed on Render: `0a55c6582d35d4e8388b5f3d1e95f6fccde5ed91`.
The ACH subscription ended through the test clock at its paid period end. The card
fallback subscription was cancelled after verification with no proration or final
invoice. Test objects are retained in Stripe for review. No real founder slot was
consumed: the five-slot counter belongs only to the separate test state file.
