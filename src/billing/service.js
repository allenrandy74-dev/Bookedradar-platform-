import { createHash } from 'node:crypto';

export const BILLING_EVENTS = [
  'checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed',
  'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
  'invoice.paid', 'invoice.payment_failed', 'invoice.payment_action_required', 'invoice.updated',
];

const id = value => typeof value === 'string' ? value : value?.id;

export class BillingError extends Error {
  constructor(code, status = 409) {
    super(code);
    this.status = status;
  }
}

export function billingState(subscription, expectedAmountCents = 49700) {
  if (['canceled', 'incomplete_expired'].includes(subscription.status)) return 'cancelled';
  if (['past_due', 'unpaid', 'paused'].includes(subscription.status)) return 'past_due';
  const invoice = subscription.latest_invoice;
  if (
    invoice?.status === 'uncollectible' ||
    (invoice?.status === 'open' && invoice.attempt_count > 0 && invoice.last_finalization_error)
  ) return 'past_due';

  if (
    subscription.status === 'active' &&
    invoice?.status === 'paid' &&
    Number(invoice.amount_paid || 0) >= Number(expectedAmountCents || 0) &&
    invoice.currency === 'usd'
  ) return 'active';

  return 'payment_pending';
}

function normalizedPlan(plan = {}) {
  return {
    profileId: String(plan.profileId || 'recover'),
    profileName: String(plan.profileName || 'RadarRecover'),
    billingTier: String(plan.billingTier || 'legacy_pilot'),
    foundingPartner: plan.foundingPartner !== false,
    setupFeeWaived: plan.setupFeeWaived !== false,
    priceId: String(plan.priceId || ''),
    monthlyUsd: Number(plan.monthlyUsd || 497),
    expectedAmountCents: Number(plan.expectedAmountCents || 49700),
  };
}

export class BillingService {
  constructor({
    stripe,
    store,
    priceId,
    priceCatalog = {},
    tenantProfile = null,
    portalConfiguration,
    baseUrl,
    tenantExists,
    mode = 'test',
  }) {
    Object.assign(this, {
      stripe,
      store,
      priceId,
      priceCatalog,
      tenantProfile,
      portalConfiguration,
      baseUrl,
      tenantExists,
      mode,
    });
    if (!['test', 'live'].includes(this.mode)) throw new Error('invalid_billing_mode');
    this.live = this.mode === 'live';
  }

  resolvePlan({ tenantId, profileId = '', foundingPartner } = {}) {
    const explicitPackageRequest =
      Boolean(String(profileId || '').trim()) ||
      typeof foundingPartner === 'boolean';

    // Preserve the existing validated $497 test-pilot lane only in test mode.
    if (!explicitPackageRequest) {
      if (this.live) throw new BillingError('package_selection_required', 400);
      if (!this.priceId) throw new BillingError('legacy_test_price_not_configured', 503);
      return normalizedPlan({
        profileId: 'recover',
        profileName: 'RadarRecover',
        billingTier: 'legacy_pilot',
        foundingPartner: true,
        setupFeeWaived: true,
        priceId: this.priceId,
        monthlyUsd: 497,
        expectedAmountCents: 49700,
      });
    }

    const configuredProfile = String(this.tenantProfile?.(tenantId) || '').trim().toLowerCase();
    const requestedProfile = String(profileId || configuredProfile || '').trim().toLowerCase();
    if (!requestedProfile) throw new BillingError('service_profile_required', 400);
    if (configuredProfile && requestedProfile !== configuredProfile) {
      throw new BillingError('billing_profile_mismatch', 409);
    }

    const founding = foundingPartner === true;
    const tier = founding ? 'founding' : 'standard';
    const plan = this.priceCatalog?.[requestedProfile]?.[tier];
    if (!plan?.priceId) throw new BillingError('package_price_not_configured', 503);

    return normalizedPlan({
      ...plan,
      profileId: requestedProfile,
      billingTier: tier,
      foundingPartner: founding,
      setupFeeWaived: founding ? true : Number(plan.setupFeeUsd || 0) === 0,
    });
  }

  accountPlan(account) {
    return normalizedPlan({
      profileId: account.profileId || 'recover',
      profileName: account.profileName || 'RadarRecover',
      billingTier: account.billingTier || 'legacy_pilot',
      foundingPartner: account.foundingPartner !== false,
      setupFeeWaived: account.setupFeeWaived !== false,
      priceId: account.priceId || this.priceId,
      monthlyUsd: account.monthlyUsd || 497,
      expectedAmountCents: account.expectedAmountCents || 49700,
    });
  }

  async validatePrice(plan) {
    if (!plan?.priceId) throw new BillingError('package_price_not_configured', 503);
    const p = await this.stripe.prices.retrieve(plan.priceId);
    if (
      p.livemode !== this.live ||
      !p.active ||
      p.currency !== 'usd' ||
      p.unit_amount !== plan.expectedAmountCents ||
      p.recurring?.interval !== 'month' ||
      p.recurring?.interval_count !== 1
    ) {
      throw new BillingError(this.live ? 'invalid_live_package_price' : 'invalid_test_package_price', 503);
    }
  }

  async validateConfiguredPriceCatalog() {
    const verified = {};
    for (const [profileId, plans] of Object.entries(this.priceCatalog || {})) {
      verified[profileId] = {};
      for (const tier of ['standard', 'founding']) {
        const plan = plans?.[tier];
        if (!plan?.priceId) {
          verified[profileId][tier] = false;
          continue;
        }
        await this.validatePrice({
          ...plan,
          profileId,
          billingTier: tier,
          foundingPartner: tier === 'founding',
        });
        verified[profileId][tier] = true;
      }
    }
    return verified;
  }

  account(data, tenantId) {
    const a = data.accounts[tenantId];
    if (!a) throw new BillingError('billing_account_not_found', 404);
    return a;
  }

  enroll({
    tenantId,
    qualified,
    agreementAccepted,
    testClock,
    profileId = '',
    foundingPartner,
  }) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(tenantId || '') || !this.tenantExists(tenantId)) {
      throw new BillingError('unknown_tenant', 400);
    }
    if (qualified !== true || agreementAccepted !== true) {
      throw new BillingError('qualification_and_agreement_required', 400);
    }
    if (testClock && this.live) throw new BillingError('test_clock_not_allowed_in_live_mode', 400);
    if (testClock && !/^clock_[a-zA-Z0-9]+$/.test(testClock)) {
      throw new BillingError('invalid_test_clock', 400);
    }

    const plan = this.resolvePlan({ tenantId, profileId, foundingPartner });

    return this.store.transaction(async data => {
      if (data.accounts[tenantId]) return data.accounts[tenantId];

      const foundingAccounts = Object.values(data.accounts)
        .filter(account => account.foundingPartner !== false);
      if (plan.foundingPartner && foundingAccounts.length >= 5) {
        throw new BillingError('founding_partner_limit_reached');
      }

      const key = createHash('sha256').update(tenantId).digest('hex');
      const customer = await this.stripe.customers.create({
        name: `${this.live ? '' : 'TEST '}BookedRadar ${tenantId}`,
        metadata: {
          bookedradar_tenant_id: tenantId,
          bookedradar_mode: this.mode,
          bookedradar_profile: plan.profileId,
          bookedradar_billing_tier: plan.billingTier,
        },
        ...(testClock ? { test_clock: testClock } : {}),
      }, { idempotencyKey: `br-${this.mode}-enroll-v2-${key}-${plan.profileId}-${plan.billingTier}` });

      if (customer.livemode !== this.live) {
        throw new BillingError(this.live ? 'test_object_rejected' : 'live_object_rejected');
      }

      const foundingPartnerNumber = plan.foundingPartner ? foundingAccounts.length + 1 : null;
      return data.accounts[tenantId] = {
        tenantId,
        mode: this.mode,
        customerId: customer.id,
        status: 'onboarding',
        profileId: plan.profileId,
        profileName: plan.profileName,
        billingTier: plan.billingTier,
        foundingPartner: plan.foundingPartner,
        foundingPartnerNumber,
        setupFeeWaived: plan.setupFeeWaived,
        priceId: plan.priceId,
        monthlyUsd: plan.monthlyUsd,
        expectedAmountCents: plan.expectedAmountCents,
        qualified: true,
        agreementAccepted: true,
        qualifiedAt: new Date().toISOString(),
        liveServiceAffected: false,
        checkoutGeneration: 0,
      };
    });
  }

  get(tenantId) {
    return this.store.transaction(data => this.account(data, tenantId));
  }

  checkout(tenantId, method = 'ach') {
    if (!['ach', 'card'].includes(method)) throw new BillingError('invalid_payment_method', 400);

    return this.store.transaction(async data => {
      const a = this.account(data, tenantId);
      const plan = this.accountPlan(a);
      await this.validatePrice(plan);

      const subscriptions = await this.stripe.subscriptions.list({
        customer: a.customerId,
        status: 'all',
        limit: 100,
      });
      if (subscriptions.data.some(s => !['canceled', 'incomplete_expired'].includes(s.status))) {
        throw new BillingError('subscription_already_exists');
      }

      if (a.checkoutId) {
        const previous = await this.stripe.checkout.sessions.retrieve(a.checkoutId);
        if (previous.status === 'open' && a.checkoutMethod === method) {
          return {
            url: previous.url,
            sessionId: previous.id,
            mode: this.mode,
            profileId: plan.profileId,
            billingTier: plan.billingTier,
          };
        }
        if (
          previous.status === 'complete' &&
          !subscriptions.data.some(s =>
            s.id === a.subscriptionId &&
            ['canceled', 'incomplete_expired'].includes(s.status)
          )
        ) throw new BillingError('checkout_already_completed');
        if (previous.status === 'open') await this.stripe.checkout.sessions.expire(previous.id);
      }

      a.checkoutGeneration += 1;
      const planLabel = `${plan.profileName}: $${plan.monthlyUsd}/month`;
      const setupLabel = plan.setupFeeWaived
        ? 'Setup fee waived.'
        : 'Any setup fee is governed by the signed service agreement.';

      const session = await this.stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: a.customerId,
        client_reference_id: tenantId,
        line_items: [{ price: plan.priceId, quantity: 1 }],
        payment_method_types: [method === 'ach' ? 'us_bank_account' : 'card'],
        ...(method === 'ach'
          ? { payment_method_options: { us_bank_account: { verification_method: 'automatic' } } }
          : {}),
        subscription_data: {
          metadata: {
            bookedradar_tenant_id: tenantId,
            bookedradar_mode: this.mode,
            bookedradar_profile: plan.profileId,
            bookedradar_billing_tier: plan.billingTier,
          },
        },
        metadata: {
          bookedradar_tenant_id: tenantId,
          bookedradar_mode: this.mode,
          bookedradar_profile: plan.profileId,
          bookedradar_billing_tier: plan.billingTier,
        },
        custom_text: {
          submit: {
            message: `${planLabel}. ${setupLabel} ACH bank payment preferred; card payment available.`,
          },
        },
        success_url: `${this.baseUrl}/billing/return?result=submitted`,
        cancel_url: `${this.baseUrl}/billing/return?result=cancelled`,
      }, {
        idempotencyKey: `br-${this.mode}-checkout-v2-${a.customerId}-${a.checkoutGeneration}-${method}-${plan.profileId}-${plan.billingTier}`,
      });

      if (session.livemode !== this.live) {
        throw new BillingError(this.live ? 'test_object_rejected' : 'live_object_rejected');
      }

      if (
        a.subscriptionId &&
        subscriptions.data.some(s =>
          s.id === a.subscriptionId &&
          ['canceled', 'incomplete_expired'].includes(s.status)
        )
      ) {
        a.retiredSubscriptionIds = [...(a.retiredSubscriptionIds || []), a.subscriptionId];
        a.subscriptionId = null;
      }

      a.checkoutId = session.id;
      a.checkoutMethod = method;
      a.status = 'payment_pending';
      return {
        url: session.url,
        sessionId: session.id,
        mode: this.mode,
        profileId: plan.profileId,
        billingTier: plan.billingTier,
        monthlyUsd: plan.monthlyUsd,
      };
    });
  }

  async portal(tenantId) {
    const a = await this.get(tenantId);
    const session = await this.stripe.billingPortal.sessions.create({
      customer: a.customerId,
      configuration: this.portalConfiguration,
      return_url: `${this.baseUrl}/billing/return`,
    });
    return { url: session.url, mode: this.mode };
  }

  processEvent(event) {
    if (event.livemode !== this.live) {
      throw new BillingError(this.live ? 'test_event_rejected' : 'live_event_rejected', 400);
    }
    if (!BILLING_EVENTS.includes(event.type)) return { ignored: true };

    return this.store.transaction(async data => {
      if (data.events[event.id]) return { duplicate: true };

      const object = event.data.object;
      const a = Object.values(data.accounts)
        .find(value => value.customerId === id(object.customer));
      if (!a) return { ignored: true };

      let subscriptionId = event.type.startsWith('customer.subscription.')
        ? object.id
        : id(object.subscription) ||
          id(object.parent?.subscription_details?.subscription);
      if (!subscriptionId) return { ignored: true };

      let sub = await this.stripe.subscriptions.retrieve(
        subscriptionId,
        { expand: ['latest_invoice'] }
      );
      const plan = this.accountPlan(a);

      if (
        sub.livemode !== this.live ||
        id(sub.customer) !== a.customerId ||
        sub.metadata?.bookedradar_tenant_id !== a.tenantId ||
        sub.metadata?.bookedradar_mode !== this.mode
      ) throw new BillingError('subscription_ownership_mismatch');

      if (
        sub.metadata?.bookedradar_profile &&
        sub.metadata.bookedradar_profile !== plan.profileId
      ) throw new BillingError('subscription_profile_mismatch');

      const items = sub.items?.data || [];
      if (
        items.length !== 1 ||
        id(items[0].price) !== plan.priceId ||
        items[0].quantity !== 1
      ) throw new BillingError('unexpected_subscription_price');

      if (
        !['canceled', 'incomplete_expired'].includes(sub.status) &&
        (
          !sub.payment_settings?.payment_method_types?.includes('card') ||
          !sub.payment_settings?.payment_method_types?.includes('us_bank_account')
        )
      ) {
        sub = await this.stripe.subscriptions.update(sub.id, {
          payment_settings: { payment_method_types: ['us_bank_account', 'card'] },
          expand: ['latest_invoice'],
        });
      }

      if (a.subscriptionId && a.subscriptionId !== sub.id && a.status !== 'cancelled') {
        return { ignored: true };
      }
      if ((a.retiredSubscriptionIds || []).includes(sub.id)) return { ignored: true };

      if (a.subscriptionId && a.subscriptionId !== sub.id) {
        a.retiredSubscriptionIds = [...(a.retiredSubscriptionIds || []), a.subscriptionId];
      }

      a.subscriptionId = sub.id;
      a.stripeStatus = sub.status;
      a.status = billingState(sub, plan.expectedAmountCents);
      a.currentPeriodEnd = items[0].current_period_end || sub.current_period_end || null;
      a.scheduledCancellationAt =
        sub.cancel_at ||
        (sub.cancel_at_period_end ? a.currentPeriodEnd : null);
      a.cancelAtPeriodEnd =
        sub.cancel_at_period_end === true ||
        Boolean(sub.cancel_at && sub.cancel_at === a.currentPeriodEnd);
      a.latestInvoiceId = id(sub.latest_invoice) || null;
      a.invoiceStatus = sub.latest_invoice?.status || null;
      a.needsPaymentAttention =
        a.status === 'past_due' ||
        (sub.latest_invoice?.status === 'open' && sub.latest_invoice?.attempt_count > 0);
      a.updatedAt = new Date().toISOString();
      a.lastEventId = event.id;

      data.events[event.id] = {
        type: event.type,
        processedAt: a.updatedAt,
      };

      return { received: true, status: a.status };
    });
  }
}
