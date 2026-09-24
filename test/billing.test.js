import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import Stripe from 'stripe';
import { BillingStore } from '../src/billing/store.js';
import { BillingService } from '../src/billing/service.js';
import { buildPriceCatalog, createBilling } from '../src/billing/http.js';

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'br-billing-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await new BillingStore(path.join(dir, 'state.json')).load();
  let customerCount = 0, checkouts = [], expired = [];
  const sub = { id: 'sub_1', livemode: false, customer: 'cus_1', status: 'active', payment_settings: { payment_method_types: ['us_bank_account', 'card'] }, metadata: { bookedradar_tenant_id: 'tenant1', bookedradar_mode: 'test' }, items: { data: [{ price: { id: 'price_pilot' }, quantity: 1, current_period_end: 2000000000 }] }, latest_invoice: { id: 'in_1', status: 'paid', amount_paid: 49700, currency: 'usd' } };
  const stripe = {
    customers: { create: async () => ({ id: `cus_${++customerCount}`, livemode: false }) },
    prices: { retrieve: async () => ({ livemode: false, active: true, currency: 'usd', unit_amount: 49700, recurring: { interval: 'month', interval_count: 1 } }) },
    subscriptions: { list: async () => ({ data: [] }), retrieve: async () => structuredClone(sub) },
    checkout: { sessions: {
      create: async params => { const session = { id: `cs_${checkouts.length + 1}`, livemode: false, status: 'open', url: 'https://checkout.stripe.com/test', params }; checkouts.push(session); return session; },
      retrieve: async id => checkouts.find(s => s.id === id),
      expire: async id => { expired.push(id); checkouts.find(s => s.id === id).status = 'expired'; },
    } },
    billingPortal: { sessions: { create: async params => ({ url: `https://billing.stripe.com/${params.customer}` }) } },
  };
  const service = new BillingService({ stripe, store, priceId: 'price_pilot', portalConfiguration: 'bpc_test', baseUrl: 'https://example.com', tenantExists: id => /^tenant\d+$/.test(id) });
  const enroll = (tenantId = 'tenant1') => service.enroll({ tenantId, qualified: true, agreementAccepted: true });
  const event = (eventId, type = 'invoice.paid') => ({ id: eventId, livemode: false, type, data: { object: { id: type.startsWith('customer.subscription.') ? 'sub_1' : 'in_1', customer: 'cus_1', parent: { subscription_details: { subscription: 'sub_1' } } } } });
  return { service, store, stripe, sub, enroll, event, checkouts, expired, dir };
}

test('qualification, known tenant and five slots are enforced under concurrency and survive restart', async t => {
  const f = await fixture(t);
  await assert.rejects(async () => f.service.enroll({ tenantId: 'unknown', qualified: true, agreementAccepted: true }), /unknown_tenant/);
  await assert.rejects(async () => f.service.enroll({ tenantId: 'tenant1', qualified: false, agreementAccepted: true }), /qualification/);
  const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => f.enroll(`tenant${i + 1}`)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 5);
  assert.equal((await f.enroll()).foundingPartnerNumber, 1);
  const restored = await new BillingStore(path.join(f.dir, 'state.json')).load();
  assert.equal(Object.keys(restored.data.accounts).length, 5);
});

test('Checkout defaults to ACH, reuses open session, expires it for card fallback, prevents duplicate subscription', async t => {
  const f = await fixture(t); await f.enroll();
  await f.service.checkout('tenant1'); await f.service.checkout('tenant1');
  assert.equal(f.checkouts.length, 1);
  assert.deepEqual(f.checkouts[0].params.payment_method_types, ['us_bank_account']);
  assert.equal(f.checkouts[0].params.line_items.length, 1);
  await f.service.checkout('tenant1', 'card');
  assert.deepEqual(f.expired, ['cs_1']);
  assert.deepEqual(f.checkouts[1].params.payment_method_types, ['card']);
  f.stripe.subscriptions.list = async () => ({ data: [{ status: 'active' }] });
  await assert.rejects(f.service.checkout('tenant1'), /subscription_already_exists/);
});

test('ACH completion stays pending until settled invoice, then becomes active; duplicates are harmless', async t => {
  const f = await fixture(t); await f.enroll();
  f.sub.latest_invoice = { id: 'in_1', status: 'open', amount_paid: 0, currency: 'usd' };
  await f.service.processEvent(f.event('evt_pending', 'checkout.session.completed'));
  assert.equal((await f.service.get('tenant1')).status, 'payment_pending');
  Object.assign(f.sub.latest_invoice, { status: 'paid', amount_paid: 49700 });
  await f.service.processEvent(f.event('evt_paid'));
  assert.equal((await f.service.get('tenant1')).status, 'active');
  assert.deepEqual(await f.service.processEvent(f.event('evt_paid')), { duplicate: true });
});

test('canonical state prevents stale paid events reactivating failed renewal or cancellation', async t => {
  const f = await fixture(t); await f.enroll();
  await f.service.processEvent(f.event('evt_paid'));
  f.sub.status = 'past_due'; f.sub.latest_invoice.status = 'open';
  await f.service.processEvent(f.event('evt_fail', 'invoice.payment_failed'));
  await f.service.processEvent(f.event('evt_stale_paid'));
  let a = await f.service.get('tenant1');
  assert.equal(a.status, 'past_due'); assert.equal(a.needsPaymentAttention, true); assert.equal(a.liveServiceAffected, false);
  f.sub.status = 'active'; f.sub.latest_invoice.status = 'paid'; f.sub.cancel_at_period_end = true;
  await f.service.processEvent(f.event('evt_scheduled', 'customer.subscription.updated'));
  a = await f.service.get('tenant1'); assert.equal(a.status, 'active'); assert.equal(a.cancelAtPeriodEnd, true);
  f.sub.status = 'canceled';
  await f.service.processEvent(f.event('evt_cancelled', 'customer.subscription.deleted'));
  await f.service.processEvent(f.event('evt_stale_again'));
  assert.equal((await f.service.get('tenant1')).status, 'cancelled');
});

test('live events, wrong tenant and unexpected prices are rejected without recording success', async t => {
  const f = await fixture(t); await f.enroll();
  await assert.rejects(async () => f.service.processEvent({ ...f.event('evt_live'), livemode: true }), /live_event_rejected/);
  f.sub.metadata.bookedradar_tenant_id = 'tenant2';
  await assert.rejects(f.service.processEvent(f.event('evt_bad')), /ownership/);
  f.sub.metadata.bookedradar_tenant_id = 'tenant1'; f.sub.items.data[0].price.id = 'price_other';
  await assert.rejects(f.service.processEvent(f.event('evt_bad')), /unexpected_subscription_price/);
  assert.equal(f.store.data.events.evt_bad, undefined);
  f.sub.items.data[0].price.id = 'price_pilot';
  await f.service.processEvent(f.event('evt_bad'));
  assert.equal((await f.service.get('tenant1')).status, 'active');
});

test('raw signed webhook works, invalid signature and unauthorized admin calls fail, live keys cannot start', async t => {
  const f = await fixture(t);
  const env = { BOOKEDRADAR_BILLING_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_test_fake', STRIPE_WEBHOOK_SECRET: 'whsec_test_secret', STRIPE_PRICE_ID: 'price_pilot', STRIPE_PORTAL_CONFIGURATION: 'bpc_test', BILLING_PUBLIC_BASE_URL: 'https://example.com', BOOKEDRADAR_BILLING_ADMIN_TOKEN: 'x'.repeat(40) };
  await assert.rejects(createBilling({ env: { ...env, STRIPE_SECRET_KEY: 'sk_live_fake' } }), /configuration_invalid/);
  const billing = await createBilling({ env, tenantExists: () => true, defaultStateFile: path.join(f.dir, 'http.json') });
  const app = express();
  app.post('/stripe/webhook', express.raw({ type: 'application/json' }), billing.webhook);
  app.use(express.json()); app.use('/api', billing.api);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${url}/api/accounts/a`)).status, 401);
  const payload = JSON.stringify({ id: 'evt_unknown', type: 'invoice.paid', livemode: false, data: { object: { customer: 'cus_unknown' } } });
  assert.equal((await fetch(`${url}/stripe/webhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload })).status, 400);
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: env.STRIPE_WEBHOOK_SECRET });
  assert.equal((await fetch(`${url}/stripe/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': signature }, body: payload })).status, 200);
});

test('a cancelled subscription can restart without a delayed old event taking ownership', async t => {
  const f = await fixture(t); await f.enroll(); await f.service.checkout('tenant1');
  await f.service.processEvent(f.event('evt_initial'));
  f.sub.status = 'canceled'; await f.service.processEvent(f.event('evt_cancel'));
  f.checkouts[0].status = 'complete';
  f.stripe.subscriptions.list = async () => ({ data: [{ id: 'sub_1', status: 'canceled' }] });
  await f.service.checkout('tenant1', 'card');
  // The old account stays cancelled until a new subscription is confirmed.
  f.sub.id = 'sub_2'; f.sub.status = 'active';
  const next = f.event('evt_next', 'checkout.session.completed'); next.data.object.subscription = 'sub_2';
  await f.service.processEvent(next);
  assert.equal((await f.service.get('tenant1')).subscriptionId, 'sub_2');
  f.sub.status = 'canceled'; await f.service.processEvent(f.event('evt_end_new'));
  f.sub.id = 'sub_1';
  await f.service.processEvent(f.event('evt_delayed_old'));
  assert.equal((await f.service.get('tenant1')).subscriptionId, 'sub_2');
});


test('ACH-first Checkout subscriptions also accept later card updates through the portal', async t => {
  const f = await fixture(t); await f.enroll();
  f.sub.payment_settings.payment_method_types = ['us_bank_account'];
  let updates = 0;
  f.stripe.subscriptions.update = async (id, params) => {
    assert.equal(id, 'sub_1'); updates++;
    f.sub.payment_settings = params.payment_settings;
    return structuredClone(f.sub);
  };
  await f.service.processEvent(f.event('evt_checkout', 'checkout.session.completed'));
  await f.service.processEvent(f.event('evt_second'));
  assert.equal(updates, 1);
  assert.deepEqual(f.sub.payment_settings.payment_method_types, ['us_bank_account', 'card']);
});


test('portal cancellation with cancel_at timestamp is recognized at the paid period end', async t => {
  const f = await fixture(t); await f.enroll();
  f.sub.cancel_at_period_end = false;
  f.sub.cancel_at = f.sub.items.data[0].current_period_end;
  await f.service.processEvent(f.event('evt_timestamp', 'customer.subscription.updated'));
  const a = await f.service.get('tenant1');
  assert.equal(a.status, 'active');
  assert.equal(a.cancelAtPeriodEnd, true);
  assert.equal(a.scheduledCancellationAt, f.sub.cancel_at);
});


test('package-aware founding checkout validates exact selected price and profile', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'br-billing-packages-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await new BillingStore(path.join(dir, 'state.json')).load();
  const created = [];
  const amounts = {
    price_answer_f: 14900,
    price_recover_f: 39700,
    price_grow_f: 59700,
    price_schedule_f: 79700,
  };
  const stripe = {
    customers: { create: async params => ({ id: 'cus_pkg', livemode: false, params }) },
    prices: { retrieve: async id => ({ livemode:false,active:true,currency:'usd',unit_amount:amounts[id],recurring:{interval:'month',interval_count:1} }) },
    subscriptions: { list: async () => ({ data: [] }) },
    checkout: { sessions: {
      create: async params => { created.push(params); return { id:'cs_pkg',livemode:false,status:'open',url:'https://checkout.stripe.com/test' }; },
      retrieve: async () => ({ id:'cs_pkg',status:'open',url:'https://checkout.stripe.com/test' }),
      expire: async () => {},
    } },
    billingPortal: { sessions: { create: async () => ({ url:'https://billing.stripe.com/test' }) } },
  };
  const priceCatalog = {
    answer:{founding:{priceId:'price_answer_f',profileName:'RadarAnswer',monthlyUsd:149,expectedAmountCents:14900,setupFeeUsd:0}},
    recover:{founding:{priceId:'price_recover_f',profileName:'RadarRecover',monthlyUsd:397,expectedAmountCents:39700,setupFeeUsd:0}},
    grow:{founding:{priceId:'price_grow_f',profileName:'RadarGrow',monthlyUsd:597,expectedAmountCents:59700,setupFeeUsd:0}},
    schedule:{founding:{priceId:'price_schedule_f',profileName:'RadarSchedule',monthlyUsd:797,expectedAmountCents:79700,setupFeeUsd:0}},
  };
  const service = new BillingService({
    stripe,store,priceCatalog,priceId:'price_legacy',
    portalConfiguration:'bpc_test',baseUrl:'https://example.com',
    tenantExists:id=>id==='tenant1',
    tenantProfile:()=> 'recover',
  });
  const account=await service.enroll({tenantId:'tenant1',qualified:true,agreementAccepted:true,profileId:'recover',foundingPartner:true});
  assert.equal(account.monthlyUsd,397);
  assert.equal(account.priceId,'price_recover_f');
  const checkout=await service.checkout('tenant1');
  assert.equal(checkout.monthlyUsd,397);
  assert.equal(created[0].line_items[0].price,'price_recover_f');
  assert.match(created[0].custom_text.submit.message,/\$397\/month/);
});

test('package billing rejects profile mismatch and missing configured price', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'br-billing-mismatch-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await new BillingStore(path.join(dir, 'state.json')).load();
  const stripe={customers:{create:async()=>({id:'cus',livemode:false})}};
  const service=new BillingService({
    stripe,store,priceId:'price_legacy',priceCatalog:{},
    portalConfiguration:'bpc',baseUrl:'https://example.com',
    tenantExists:()=>true,tenantProfile:()=> 'grow'
  });
  assert.throws(
    () => service.enroll({tenantId:'tenant1',qualified:true,agreementAccepted:true,profileId:'recover',foundingPartner:true}),
    /billing_profile_mismatch/
  );
  assert.throws(
    () => service.enroll({tenantId:'tenant1',qualified:true,agreementAccepted:true,profileId:'grow',foundingPartner:true}),
    /package_price_not_configured/
  );
});

test('price catalog maps configured package Stripe ids to published amounts', () => {
  const catalog=buildPriceCatalog({
    STRIPE_PRICE_ID:'price_recover_standard',
    STRIPE_PRICE_ANSWER_FOUNDING:'price_answer_f',
    STRIPE_PRICE_RECOVER_FOUNDING:'price_recover_f',
    STRIPE_PRICE_GROW_FOUNDING:'price_grow_f',
    STRIPE_PRICE_SCHEDULE_FOUNDING:'price_schedule_f'
  });
  assert.equal(catalog.answer.founding.expectedAmountCents,14900);
  assert.equal(catalog.recover.founding.expectedAmountCents,39700);
  assert.equal(catalog.grow.founding.expectedAmountCents,59700);
  assert.equal(catalog.schedule.founding.expectedAmountCents,79700);
  assert.equal(catalog.recover.standard.expectedAmountCents,49700);
});


test('live billing requires an explicit second arm and live credentials', async t => {
  const dir=await mkdtemp(path.join(os.tmpdir(),'br-billing-live-config-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const base={
    BOOKEDRADAR_BILLING_ENABLED:'true',
    BOOKEDRADAR_BILLING_MODE:'live',
    STRIPE_SECRET_KEY:'sk_live_fake',
    STRIPE_WEBHOOK_SECRET:'whsec_live_secret',
    STRIPE_PRICE_RECOVER_STANDARD:'price_live_recover',
    STRIPE_PORTAL_CONFIGURATION:'bpc_live',
    BILLING_PUBLIC_BASE_URL:'https://example.com',
    BOOKEDRADAR_BILLING_ADMIN_TOKEN:'x'.repeat(40),
  };
  await assert.rejects(
    createBilling({env:base,tenantExists:()=>true,defaultStateFile:path.join(dir,'live.json')}),
    /live_billing_not_armed/
  );
  await assert.rejects(
    createBilling({env:{...base,BOOKEDRADAR_BILLING_LIVE_ARMED:'true',STRIPE_SECRET_KEY:'sk_test_wrong'},tenantExists:()=>true,defaultStateFile:path.join(dir,'live2.json')}),
    /live_billing_configuration_invalid/
  );
});

test('live BillingService rejects test objects and accepts live package objects', async t => {
  const dir=await mkdtemp(path.join(os.tmpdir(),'br-billing-live-service-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const store=await new BillingStore(path.join(dir,'state.json'),{mode:'live'}).load();
  const checkouts=[];
  const sub={
    id:'sub_live_1',livemode:true,customer:'cus_live_1',status:'active',
    payment_settings:{payment_method_types:['us_bank_account','card']},
    metadata:{bookedradar_tenant_id:'tenant1',bookedradar_mode:'live',bookedradar_profile:'recover'},
    items:{data:[{price:{id:'price_live_recover'},quantity:1,current_period_end:2000000000}]},
    latest_invoice:{id:'in_live_1',status:'paid',amount_paid:49700,currency:'usd'}
  };
  const stripe={
    customers:{create:async()=>({id:'cus_live_1',livemode:true})},
    prices:{retrieve:async()=>({livemode:true,active:true,currency:'usd',unit_amount:49700,recurring:{interval:'month',interval_count:1}})},
    subscriptions:{list:async()=>({data:[]}),retrieve:async()=>structuredClone(sub)},
    checkout:{sessions:{
      create:async params=>{const s={id:'cs_live_1',livemode:true,status:'open',url:'https://checkout.stripe.com/live',params};checkouts.push(s);return s;},
      retrieve:async()=>checkouts[0],expire:async()=>{}
    }},
    billingPortal:{sessions:{create:async()=>({url:'https://billing.stripe.com/live'})}}
  };
  const service=new BillingService({
    stripe,store,mode:'live',priceId:'price_live_recover',
    priceCatalog:{recover:{standard:{priceId:'price_live_recover',profileName:'RadarRecover',monthlyUsd:497,expectedAmountCents:49700,setupFeeUsd:499}}},
    tenantProfile:()=> 'recover',tenantExists:()=>true,portalConfiguration:'bpc_live',baseUrl:'https://example.com'
  });
  const account=await service.enroll({tenantId:'tenant1',qualified:true,agreementAccepted:true,profileId:'recover',foundingPartner:false});
  assert.equal(account.mode,'live');
  const checkout=await service.checkout('tenant1');
  assert.equal(checkout.mode,'live');
  assert.equal(checkouts[0].params.metadata.bookedradar_mode,'live');

  await service.processEvent({id:'evt_live_ok',livemode:true,type:'invoice.paid',data:{object:{id:'in_live_1',customer:'cus_live_1',parent:{subscription_details:{subscription:'sub_live_1'}}}}});
  assert.equal((await service.get('tenant1')).status,'active');

  assert.throws(
    () => service.processEvent({id:'evt_test_wrong',livemode:false,type:'invoice.paid',data:{object:{customer:'cus_live_1'}}}),
    /test_event_rejected/
  );
});

test('billing stores keep test and live state isolated', async t => {
  const dir=await mkdtemp(path.join(os.tmpdir(),'br-billing-store-mode-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'state.json');
  const testStore=await new BillingStore(file,{mode:'test'}).load();
  await testStore.transaction(data=>{data.accounts.a={tenantId:'a'};return true;});
  await assert.rejects(new BillingStore(file,{mode:'live'}).load(),/invalid_billing_store/);
});


test('live billing refuses an incomplete published package catalog before Stripe network use', async t => {
  const dir=await mkdtemp(path.join(os.tmpdir(),'br-billing-live-catalog-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const env={
    BOOKEDRADAR_BILLING_ENABLED:'true',
    BOOKEDRADAR_BILLING_MODE:'live',
    BOOKEDRADAR_BILLING_LIVE_ARMED:'true',
    STRIPE_SECRET_KEY:'sk_live_fake',
    STRIPE_WEBHOOK_SECRET:'whsec_live_secret',
    STRIPE_PRICE_RECOVER_STANDARD:'price_live_recover',
    STRIPE_PORTAL_CONFIGURATION:'bpc_live',
    BILLING_PUBLIC_BASE_URL:'https://example.com',
    BOOKEDRADAR_BILLING_ADMIN_TOKEN:'x'.repeat(40),
  };
  await assert.rejects(
    createBilling({env,tenantExists:()=>true,defaultStateFile:path.join(dir,'live.json')}),
    /live_package_prices_incomplete/
  );
});

test('live package catalog verification rejects a test-mode price object', async t => {
  const dir=await mkdtemp(path.join(os.tmpdir(),'br-billing-live-verify-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const store=await new BillingStore(path.join(dir,'state.json'),{mode:'live'}).load();
  const stripe={
    prices:{retrieve:async()=>({livemode:false,active:true,currency:'usd',unit_amount:14900,recurring:{interval:'month',interval_count:1}})}
  };
  const service=new BillingService({
    stripe,store,mode:'live',
    priceCatalog:{answer:{standard:{priceId:'price_wrong',monthlyUsd:149,expectedAmountCents:14900}}},
    tenantExists:()=>true,portalConfiguration:'bpc',baseUrl:'https://example.com'
  });
  await assert.rejects(service.validateConfiguredPriceCatalog(),/invalid_live_package_price/);
});
