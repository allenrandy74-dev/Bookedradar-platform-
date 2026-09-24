import express from 'express';
import Stripe from 'stripe';
import { requireBearer } from '../auth.js';
import { BillingStore } from './store.js';
import { BillingError, BillingService } from './service.js';

export async function createBilling({ env = process.env, tenantExists, defaultStateFile }) {
  if (env.BOOKEDRADAR_BILLING_ENABLED !== 'true') return null;
  if (!/^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY || '') || !env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_') || !env.STRIPE_PRICE_ID?.startsWith('price_') || !env.STRIPE_PORTAL_CONFIGURATION?.startsWith('bpc_') || (env.BOOKEDRADAR_BILLING_ADMIN_TOKEN || '').length < 32) throw new Error('test_billing_configuration_invalid');
  const baseUrl = new URL(env.BILLING_PUBLIC_BASE_URL);
  if (baseUrl.protocol !== 'https:') throw new Error('billing_requires_https');
  const stripe = new Stripe(env.STRIPE_SECRET_KEY, { maxNetworkRetries: 1, timeout: 10000 });
  const store = await new BillingStore(env.BILLING_STATE_FILE || defaultStateFile).load();
  const service = new BillingService({ stripe, store, tenantExists, priceId: env.STRIPE_PRICE_ID, portalConfiguration: env.STRIPE_PORTAL_CONFIGURATION, baseUrl: baseUrl.origin });
  const api = express.Router();
  api.use(requireBearer(env.BOOKEDRADAR_BILLING_ADMIN_TOKEN, 'billing_admin_token'));
  const handle = fn => async (req, res) => {
    try { res.json({ ok: true, ...await fn(req) }); }
    catch (error) { res.status(error instanceof BillingError ? error.status : 503).json({ ok: false, error: error instanceof BillingError ? error.message : 'billing_operation_failed' }); }
  };
  api.post('/accounts', handle(async req => ({ account: await service.enroll(req.body || {}) })));
  api.get('/accounts/:tenantId', handle(async req => ({ account: await service.get(req.params.tenantId) })));
  api.post('/accounts/:tenantId/checkout', handle(req => service.checkout(req.params.tenantId, req.body?.method || 'ach')));
  api.post('/accounts/:tenantId/portal', handle(req => service.portal(req.params.tenantId)));
  const webhook = async (req, res) => {
    let event;
    try { event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], env.STRIPE_WEBHOOK_SECRET); }
    catch { return res.status(400).json({ ok: false, error: 'invalid_stripe_signature' }); }
    try { return res.json(await service.processEvent(event)); }
    catch (error) { return res.status(error instanceof BillingError ? error.status : 503).json({ ok: false, error: 'billing_event_processing_failed' }); }
  };
  return { api, webhook, service };
}
