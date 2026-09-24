# BookedRadar Billing Setup — Launch Configuration

Updated: 2026-09-24

## Business identity
- Legal entity: BookedRadar LLC
- Entity type: Texas single-member LLC
- Business bank: dedicated BookedRadar LLC business checking account
- Public website: https://www.bookedradar.com
- Customer support email: randy@bookedradar.com
- Business model: recurring managed AI call answering, lead capture, routing, follow-up, and opportunity-recovery service for service businesses.

Never store EIN, bank routing/account numbers, SSN, or Stripe secret keys in this repository.

## Stripe account configuration
Create the Stripe account under BookedRadar LLC, not the owner personally.

Use the actual physical operating address when Stripe asks for the physical business location. Use the BookedRadar mailing address only in fields that explicitly accept a mailing address.

Connect only the dedicated BookedRadar LLC business checking account for payouts.

## Launch product
Product name: BookedRadar Founding Partner Pilot

Public launch price: $497 USD per month

Billing interval: monthly

Setup fee: waived for the first five qualified founding partners under the current public offer.

Usage: direct usage costs may be separate. Do not configure an unlimited-usage promise.

Do not create usage-based overages until actual customer usage data supports a clear allowance and pricing model.

## Payment methods
Preferred: ACH Direct Debit for recurring B2B payments.
Fallback: credit/debit card.

Customer payment credentials should be hosted/handled by Stripe. BookedRadar must not store raw card or bank credentials.

For ACH, use Stripe-hosted authorization/mandate collection rather than custom consent text unless counsel approves a custom flow.

BookedRadar provides services, not physical/digital goods; configure ACH transaction purpose/classification accordingly where Stripe requests it.

## Checkout / subscription flow
1. Customer approves pilot scope and signs the applicable agreement/order form.
2. Create or select the BookedRadar customer in Stripe.
3. Customer enters payment details through Stripe-hosted Checkout or equivalent hosted flow.
4. Subscription begins only under the agreed commercial start terms.
5. Stripe sends payment/subscription events to BookedRadar.
6. BookedRadar records billing state but never treats payment-provider events as recovery revenue attribution.
7. Customer may manage payment details/invoices through the Stripe-hosted customer portal when enabled.

## Webhook events — Phase 1
At minimum handle and idempotently record:
- checkout.session.completed
- customer.subscription.created
- customer.subscription.updated
- customer.subscription.deleted
- invoice.paid
- invoice.payment_failed

Consider payment_method and dispute/refund events when those operational flows are implemented.

Webhook signatures must be verified. Reject unsigned/invalid events. Never log secrets or full payment credentials.

## Customer status
Recommended internal billing states:
- onboarding
- payment_pending
- active
- past_due
- suspended
- cancelled

Do not automatically suspend a live customer on the first transient payment failure until the customer agreement and cure-period rules are finalized.

## Test-mode acceptance — required before first live charge
Run in Stripe test mode first:
1. Create test customer.
2. Complete hosted checkout for the $497 monthly plan.
3. Verify subscription-created event.
4. Verify invoice-paid event.
5. Verify BookedRadar billing state becomes active.
6. Open customer portal and update payment method.
7. Simulate failed renewal/payment.
8. Verify past-due alert/state without destructive automation.
9. Test cancellation.
10. Test refund/credit-note workflow if offered.
11. Confirm webhook replay/idempotency does not duplicate state changes.
12. Confirm no raw payment credentials appear in BookedRadar logs/data.
13. Delete/close test artifacts as appropriate.

Only after the complete test lifecycle passes should live billing be enabled.

## Still requires professional/business decision before first paid customer
- Final customer service/subscription agreement and cancellation/cure terms.
- Texas sales-tax treatment and permit decision with CPA.
- Accounting/bookkeeping workflow.
- Insurance review.

## Approved pilot boundary — September 24, 2026
The $497/month Founding Partner Pilot covers the agreed call-answering, lead-capture,
routing, follow-up and appointment-request workflow. The setup fee is waived for the
first five qualified founding partners. It is not an unlimited-call or unlimited-usage
plan. Volume, coverage hours, integrations and any separate usage costs must be stated
in the customer order before signing or payment.

An appointment request is not a confirmed booking. Capture the preferred time and tell
the caller the business will confirm availability. Full-time scheduling, direct calendar
booking, technician assignment, travel-aware routing, dispatch and schedule optimization
require a separate scope, setup quote, recurring price and customer-specific acceptance.
No advanced-scheduling price or setup-fee waiver has been approved.
