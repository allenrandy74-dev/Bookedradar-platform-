import { createHash } from 'node:crypto';

export const BILLING_EVENTS = [
  'checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed',
  'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
  'invoice.paid', 'invoice.payment_failed', 'invoice.payment_action_required', 'invoice.updated',
];
const id = value => typeof value === 'string' ? value : value?.id;
export class BillingError extends Error {
  constructor(code, status = 409) { super(code); this.status = status; }
}
export function billingState(subscription) {
  if (['canceled', 'incomplete_expired'].includes(subscription.status)) return 'cancelled';
  if (['past_due', 'unpaid', 'paused'].includes(subscription.status)) return 'past_due';
  const invoice = subscription.latest_invoice;
  if (invoice?.status === 'uncollectible' || (invoice?.status === 'open' && invoice.attempt_count > 0 && invoice.last_finalization_error)) return 'past_due';
  // A completed Checkout or an active ACH subscription is not proof of settlement.
  if (subscription.status === 'active' && invoice?.status === 'paid' && invoice.amount_paid >= 49700 && invoice.currency === 'usd') return 'active';
  return 'payment_pending';
}
export class BillingService {
  constructor({ stripe, store, priceId, portalConfiguration, baseUrl, tenantExists }) {
    Object.assign(this, { stripe, store, priceId, portalConfiguration, baseUrl, tenantExists });
  }
  async validatePrice() {
    const p = await this.stripe.prices.retrieve(this.priceId);
    if (p.livemode !== false || !p.active || p.currency !== 'usd' || p.unit_amount !== 49700 || p.recurring?.interval !== 'month' || p.recurring?.interval_count !== 1) throw new BillingError('invalid_test_pilot_price', 503);
  }
  account(data, tenantId) {
    const a = data.accounts[tenantId];
    if (!a) throw new BillingError('billing_account_not_found', 404);
    return a;
  }
  enroll({ tenantId, qualified, agreementAccepted, testClock }) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(tenantId || '') || !this.tenantExists(tenantId)) throw new BillingError('unknown_tenant', 400);
    if (qualified !== true || agreementAccepted !== true) throw new BillingError('qualification_and_agreement_required', 400);
    if (testClock && !/^clock_[a-zA-Z0-9]+$/.test(testClock)) throw new BillingError('invalid_test_clock', 400);
    return this.store.transaction(async data => {
      if (data.accounts[tenantId]) return data.accounts[tenantId];
      if (Object.keys(data.accounts).length >= 5) throw new BillingError('founding_partner_limit_reached');
      const key = createHash('sha256').update(tenantId).digest('hex');
      const customer = await this.stripe.customers.create({
        name: `TEST BookedRadar ${tenantId}`,
        metadata: { bookedradar_tenant_id: tenantId, bookedradar_mode: 'test' },
        ...(testClock ? { test_clock: testClock } : {}),
      }, { idempotencyKey: `br-test-enroll-v1-${key}` });
      if (customer.livemode !== false) throw new BillingError('live_object_rejected');
      return data.accounts[tenantId] = { tenantId, mode: 'test', customerId: customer.id, status: 'onboarding',
        foundingPartnerNumber: Object.keys(data.accounts).length + 1, setupFeeWaived: true,
        qualified: true, agreementAccepted: true, qualifiedAt: new Date().toISOString(),
        liveServiceAffected: false, checkoutGeneration: 0 };
    });
  }
  get(tenantId) { return this.store.transaction(data => this.account(data, tenantId)); }
  checkout(tenantId, method = 'ach') {
    if (!['ach', 'card'].includes(method)) throw new BillingError('invalid_payment_method', 400);
    return this.store.transaction(async data => {
      const a = this.account(data, tenantId);
      await this.validatePrice();
      const subscriptions = await this.stripe.subscriptions.list({ customer: a.customerId, status: 'all', limit: 100 });
      if (subscriptions.data.some(s => !['canceled', 'incomplete_expired'].includes(s.status))) throw new BillingError('subscription_already_exists');
      if (a.checkoutId) {
        const previous = await this.stripe.checkout.sessions.retrieve(a.checkoutId);
        if (previous.status === 'open' && a.checkoutMethod === method) return { url: previous.url, sessionId: previous.id, mode: 'test' };
        if (previous.status === 'complete' && !subscriptions.data.some(s => s.id === a.subscriptionId && ['canceled', 'incomplete_expired'].includes(s.status))) throw new BillingError('checkout_already_completed');
        if (previous.status === 'open') await this.stripe.checkout.sessions.expire(previous.id);
      }
      a.checkoutGeneration += 1;
      const session = await this.stripe.checkout.sessions.create({
        mode: 'subscription', customer: a.customerId, client_reference_id: tenantId,
        line_items: [{ price: this.priceId, quantity: 1 }], payment_method_types: [method === 'ach' ? 'us_bank_account' : 'card'],
        ...(method === 'ach' ? { payment_method_options: { us_bank_account: { verification_method: 'automatic' } } } : {}),
        subscription_data: { metadata: { bookedradar_tenant_id: tenantId, bookedradar_mode: 'test' } },
        metadata: { bookedradar_tenant_id: tenantId, bookedradar_mode: 'test' },
        custom_text: { submit: { message: 'Founding Partner Pilot: $497/month. Setup fee waived. ACH bank payment preferred; card payment available on request.' } },
        success_url: `${this.baseUrl}/billing/return?result=submitted`, cancel_url: `${this.baseUrl}/billing/return?result=cancelled`,
      }, { idempotencyKey: `br-test-checkout-${a.customerId}-${a.checkoutGeneration}-${method}` });
      if (session.livemode !== false) throw new BillingError('live_object_rejected');
      if (a.subscriptionId && subscriptions.data.some(s => s.id === a.subscriptionId && ['canceled', 'incomplete_expired'].includes(s.status))) {
        a.retiredSubscriptionIds = [...(a.retiredSubscriptionIds || []), a.subscriptionId];
        a.subscriptionId = null;
      }
      a.checkoutId = session.id; a.checkoutMethod = method; a.status = 'payment_pending';
      return { url: session.url, sessionId: session.id, mode: 'test' };
    });
  }
  async portal(tenantId) {
    const a = await this.get(tenantId);
    const session = await this.stripe.billingPortal.sessions.create({ customer: a.customerId, configuration: this.portalConfiguration, return_url: `${this.baseUrl}/billing/return` });
    return { url: session.url, mode: 'test' };
  }
  processEvent(event) {
    if (event.livemode !== false) throw new BillingError('live_event_rejected', 400);
    if (!BILLING_EVENTS.includes(event.type)) return { ignored: true };
    return this.store.transaction(async data => {
      if (data.events[event.id]) return { duplicate: true };
      const object = event.data.object;
      const a = Object.values(data.accounts).find(value => value.customerId === id(object.customer));
      if (!a) return { ignored: true };
      let subscriptionId = event.type.startsWith('customer.subscription.') ? object.id : id(object.subscription) || id(object.parent?.subscription_details?.subscription);
      if (!subscriptionId) return { ignored: true };
      let sub = await this.stripe.subscriptions.retrieve(subscriptionId, { expand: ['latest_invoice'] });
      if (sub.livemode !== false || id(sub.customer) !== a.customerId || sub.metadata?.bookedradar_tenant_id !== a.tenantId || sub.metadata?.bookedradar_mode !== 'test') throw new BillingError('subscription_ownership_mismatch');
      const items = sub.items?.data || [];
      if (items.length !== 1 || id(items[0].price) !== this.priceId || items[0].quantity !== 1) throw new BillingError('unexpected_subscription_price');
      // Checkout offers ACH first, while recurring invoices and portal updates accept cards too.
      if (!['canceled', 'incomplete_expired'].includes(sub.status) &&
          (!sub.payment_settings?.payment_method_types?.includes('card') || !sub.payment_settings?.payment_method_types?.includes('us_bank_account'))) {
        sub = await this.stripe.subscriptions.update(sub.id, {
          payment_settings: { payment_method_types: ['us_bank_account', 'card'] }, expand: ['latest_invoice'],
        });
      }
      // Once replaced, delayed events from an older subscription cannot overwrite the new one.
      if (a.subscriptionId && a.subscriptionId !== sub.id && a.status !== 'cancelled') return { ignored: true };
      if ((a.retiredSubscriptionIds || []).includes(sub.id)) return { ignored: true };
      if (a.subscriptionId && a.subscriptionId !== sub.id) a.retiredSubscriptionIds = [...(a.retiredSubscriptionIds || []), a.subscriptionId];
      a.subscriptionId = sub.id; a.stripeStatus = sub.status; a.status = billingState(sub);
      a.currentPeriodEnd = items[0].current_period_end || sub.current_period_end || null;
      a.scheduledCancellationAt = sub.cancel_at || (sub.cancel_at_period_end ? a.currentPeriodEnd : null);
      a.cancelAtPeriodEnd = sub.cancel_at_period_end === true || Boolean(sub.cancel_at && sub.cancel_at === a.currentPeriodEnd);
      a.latestInvoiceId = id(sub.latest_invoice) || null;
      a.invoiceStatus = sub.latest_invoice?.status || null;
      a.needsPaymentAttention = a.status === 'past_due' || (sub.latest_invoice?.status === 'open' && sub.latest_invoice?.attempt_count > 0);
      a.updatedAt = new Date().toISOString(); a.lastEventId = event.id;
      data.events[event.id] = { type: event.type, processedAt: a.updatedAt };
      // Only an audit marker is retained, never raw Stripe payloads or payment details.
      return { received: true, status: a.status };
    });
  }
}
