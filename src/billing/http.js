import express from 'express';
import Stripe from 'stripe';
import { requireBearer } from '../auth.js';
import { serviceProfile } from '../onboarding/service-profiles.js';
import { BillingStore } from './store.js';
import { BillingError, BillingService } from './service.js';

const PROFILE_IDS = ['answer', 'recover', 'grow', 'schedule'];

function buildPriceCatalog(env) {
  const catalog = {};
  for (const profileId of PROFILE_IDS) {
    const profile = serviceProfile(profileId);
    const upper = profileId.toUpperCase();
    const standardPriceId =
      env[`STRIPE_PRICE_${upper}_STANDARD`] ||
      (profileId === 'recover' ? env.STRIPE_PRICE_ID : '');
    const foundingPriceId = env[`STRIPE_PRICE_${upper}_FOUNDING`] || '';

    catalog[profileId] = {
      standard: standardPriceId ? {
        priceId: standardPriceId,
        profileName: profile.name,
        monthlyUsd: profile.pricing.monthlyUsd,
        expectedAmountCents: profile.pricing.monthlyUsd * 100,
        setupFeeUsd: profile.pricing.standardSetupUsd,
        setupFeeWaived: profile.pricing.standardSetupUsd === 0,
      } : null,
      founding: foundingPriceId ? {
        priceId: foundingPriceId,
        profileName: profile.name,
        monthlyUsd: profile.pricing.foundingMonthlyUsd,
        expectedAmountCents: profile.pricing.foundingMonthlyUsd * 100,
        setupFeeUsd: profile.pricing.foundingSetupUsd,
        setupFeeWaived: profile.pricing.foundingSetupUsd === 0,
      } : null,
    };
  }
  return catalog;
}

function anyConfiguredPrice(priceCatalog, legacyPriceId = '') {
  if (legacyPriceId?.startsWith('price_')) return true;
  return Object.values(priceCatalog).some(plans =>
    Object.values(plans || {}).some(plan => plan?.priceId?.startsWith('price_'))
  );
}

export async function createBilling({
  env = process.env,
  tenantExists,
  tenantProfile = null,
  defaultStateFile,
}) {
  if (env.BOOKEDRADAR_BILLING_ENABLED !== 'true') return null;

  const mode = String(env.BOOKEDRADAR_BILLING_MODE || 'test').trim().toLowerCase();
  if (!['test', 'live'].includes(mode)) throw new Error('billing_mode_invalid');
  if (mode === 'live' && env.BOOKEDRADAR_BILLING_LIVE_ARMED !== 'true') {
    throw new Error('live_billing_not_armed');
  }

  const priceCatalog = buildPriceCatalog(env);
  const keyPattern = mode === 'live' ? /^(sk|rk)_live_/ : /^(sk|rk)_test_/;
  if (
    !keyPattern.test(env.STRIPE_SECRET_KEY || '') ||
    !env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_') ||
    !anyConfiguredPrice(priceCatalog, env.STRIPE_PRICE_ID) ||
    !env.STRIPE_PORTAL_CONFIGURATION?.startsWith('bpc_') ||
    (env.BOOKEDRADAR_BILLING_ADMIN_TOKEN || '').length < 32
  ) {
    throw new Error(mode === 'live' ? 'live_billing_configuration_invalid' : 'test_billing_configuration_invalid');
  }

  const baseUrl = new URL(env.BILLING_PUBLIC_BASE_URL);
  if (baseUrl.protocol !== 'https:') throw new Error('billing_requires_https');

  const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    maxNetworkRetries: 1,
    timeout: 10000,
  });
  const store = await new BillingStore(
    env.BILLING_STATE_FILE || defaultStateFile,
    { mode }
  ).load();

  const service = new BillingService({
    stripe,
    store,
    tenantExists,
    tenantProfile,
    priceId: env.STRIPE_PRICE_ID || priceCatalog.recover?.standard?.priceId || '',
    priceCatalog,
    portalConfiguration: env.STRIPE_PORTAL_CONFIGURATION,
    baseUrl: baseUrl.origin,
    mode,
  });

  const api = express.Router();
  api.use(requireBearer(
    env.BOOKEDRADAR_BILLING_ADMIN_TOKEN,
    'billing_admin_token'
  ));

  const handle = fn => async (req, res) => {
    try {
      res.json({ ok: true, ...await fn(req) });
    } catch (error) {
      res.status(error instanceof BillingError ? error.status : 503).json({
        ok: false,
        error: error instanceof BillingError
          ? error.message
          : 'billing_operation_failed',
      });
    }
  };

  api.post('/accounts', handle(async req => ({
    account: await service.enroll(req.body || {}),
  })));
  api.get('/accounts/:tenantId', handle(async req => ({
    account: await service.get(req.params.tenantId),
  })));
  api.post('/accounts/:tenantId/checkout', handle(req =>
    service.checkout(req.params.tenantId, req.body?.method || 'ach')
  ));
  api.post('/accounts/:tenantId/portal', handle(req =>
    service.portal(req.params.tenantId)
  ));

  const webhook = async (req, res) => {
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        req.headers['stripe-signature'],
        env.STRIPE_WEBHOOK_SECRET
      );
    } catch {
      return res.status(400).json({
        ok: false,
        error: 'invalid_stripe_signature',
      });
    }

    try {
      return res.json(await service.processEvent(event));
    } catch (error) {
      return res.status(error instanceof BillingError ? error.status : 503).json({
        ok: false,
        error: 'billing_event_processing_failed',
      });
    }
  };

  return {
    api,
    webhook,
    service,
    billingMode: mode,
    configuredPackagePrices: Object.fromEntries(
      Object.entries(priceCatalog).map(([profileId, plans]) => [
        profileId,
        {
          standard: Boolean(plans.standard),
          founding: Boolean(plans.founding),
        },
      ])
    ),
  };
}

export { buildPriceCatalog };
