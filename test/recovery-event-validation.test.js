import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RecoveryStore } from '../src/recovery/store.js';
import { RecoveryEngine } from '../src/recovery/engine.js';

const tenant = { tenantId: 'validation', economics: { defaultAverageJobValue: 500 } };
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'br-event-validation-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new RecoveryStore(path.join(dir, 'state.json'));
  await store.load();
  return { store, engine: new RecoveryEngine({ store, tenant }) };
}
const lead = { type: 'phone_lead', contact: { phone: '+12025550101' } };
const invalidMoney = [null, '', ' ', 'not-money', -1, '-0.1', NaN, Infinity, -Infinity, 'Infinity', '0x10', '0b10', '0o10', true, false, [], {}, [10]];

test('schema rejects malformed events before mutation and before delegated ingestion', async t => {
  const { store, engine } = await fixture(t);
  const invalid = [null, [], 'event', {}, { type: 'contact_opted_out' }, { type: '' }, { type: 42 },
    ...[null, '', ' ', 'invalid', NaN, Infinity, true, {}, []].map(occurredAt => ({ ...lead, occurredAt })),
    ...[null, [], 'name'].map(contact => ({ ...lead, contact })),
    ...[null, [], 'metadata'].map(metadata => ({ ...lead, metadata })),
    { ...lead, idempotencyKey: {} }, { ...lead, id: '' }, { ...lead, opportunityId: [] },
    { ...lead, tenantId: 'foreign' }, { ...lead, contact: { tenantId: 'foreign' } },
    { ...lead, contact: { phone: {} } }, { ...lead, contact: { marketingConsent: 'false' } },
    ...['revenue_confirmed', 'customer_replied', 'booking_confirmed', 'opportunity_won', 'opportunity_lost'].map(type => ({ type })),
  ];
  const before = await store.snapshot();
  let delegated = 0;
  const delegate = new RecoveryEngine({ tenant, store: { ingest: async () => { delegated++; } } });
  for (const event of invalid) {
    await assert.rejects(engine.ingest(event));
    await assert.rejects(delegate.ingest(event));
    assert.deepEqual(await store.snapshot(), before);
  }
  assert.equal(delegated, 0);
});

test('all monetary event fields reject coercion, negative and nonfinite values without durable receipts', async t => {
  const { store, engine } = await fixture(t);
  const created = await engine.ingest(lead);
  const before = await store.snapshot();
  let delegated = 0;
  const delegate = new RecoveryEngine({ tenant, store: { ingest: async () => { delegated++; } } });
  for (const field of ['amount', 'estimateAmount', 'estimatedOpportunityValue', 'estimatedRecoveredValue']) {
    for (const value of invalidMoney.filter(value => field === 'amount' || value !== null)) {
      const event = { type: 'revenue_confirmed', opportunityId: created.opportunity.id, amount: 10, [field]: value };
      await assert.rejects(engine.ingest(event), /amount/i);
      await assert.rejects(delegate.ingest(event), /amount/i);
      assert.deepEqual(await store.snapshot(), before);
    }
  }
  await assert.rejects(engine.ingest({ type: 'revenue_confirmed', opportunityId: created.opportunity.id }), /amount/i);
  assert.equal(delegated, 0);
  assert.deepEqual(await new RecoveryStore(store.filePath).snapshot(), before);
});

test('unknown or cross-tenant opportunity references fail before receipts and allow corrected retries', async t => {
  const { store, engine } = await fixture(t);
  await store.createOpportunity({ id: 'foreign', tenantId: 'other' });
  const before = await store.snapshot();
  for (const type of ['customer_replied', 'revenue_confirmed', 'booking_confirmed', 'opportunity_won', 'opportunity_lost']) {
    for (const opportunityId of ['missing', 'foreign']) {
      await assert.rejects(engine.ingest({ type, idempotencyKey: `${type}:${opportunityId}`, opportunityId, amount: 10 }), /opportunity|tenant/i);
      assert.deepEqual(await store.snapshot(), before);
    }
  }
  const created = await engine.ingest(lead);
  const revenue = await engine.ingest({ type: 'revenue_confirmed', idempotencyKey: 'revenue_confirmed:missing', opportunityId: created.opportunity.id, amount: '12.50' });
  assert.equal(revenue.attribution.confirmedRevenue, 12.5);
});

test('numeric money and timestamps, custom playbooks, explicit zero and duplicate events remain supported', async t => {
  const { store, engine } = await fixture(t);
  const created = await engine.ingest({ ...lead, occurredAt: 0, estimateAmount: '0', idempotencyKey: 'zero' });
  assert.equal(created.opportunity.estimatedOpportunityValue, 0);
  assert.equal((await engine.ingest({ ...lead, idempotencyKey: 'zero' })).duplicate, true);
  const closed = await engine.ingest({ type: 'booking_confirmed', opportunityId: created.opportunity.id, estimatedRecoveredValue: '0' });
  assert.equal(closed.recovered, true);
  assert.equal((await store.snapshot()).attribution[created.opportunity.id].estimatedRecoveredValue, 0);
  await engine.ingest({ type: 'revenue_confirmed', opportunityId: created.opportunity.id, amount: 0 });
  assert.equal((await store.snapshot()).attribution[created.opportunity.id].confirmedRevenue, 0);
  const custom = new RecoveryEngine({ store, tenant: { ...tenant, playbooks: { custom: [] } } });
  assert.equal((await custom.ingest({ type: 'custom' })).reason, 'no_playbook');
});

for (const type of ['booking_confirmed', 'opportunity_won', 'opportunity_lost', 'contact_opted_out']) {
  test(`late replies preserve ${type} opportunity, contact, action and attribution state across reload`, async t => {
    const { store, engine } = await fixture(t);
    const created = await engine.ingest(lead);
    await engine.ingest({ type, opportunityId: created.opportunity.id });
    const before = await store.snapshot();
    const reply = { type: 'customer_replied', idempotencyKey: 'late', opportunityId: created.opportunity.id, occurredAt: '2020-01-01T00:00:00Z', contact: { phone: '+12025550102', optedOut: false, suppressed: false } };
    const result = await engine.ingest(reply);
    assert.equal(result.ignored, true);
    assert.equal(result.engaged, false);
    assert.equal(result.reason, 'opportunity_closed');
    assert.equal((await engine.ingest(reply)).duplicate, true);
    const after = await new RecoveryStore(store.filePath).snapshot();
    for (const key of ['opportunities', 'contacts', 'actions', 'attribution']) assert.deepEqual(after[key], before[key]);
    assert.equal(after.events.length, before.events.length + 1);
  });
}

test('markRecovered rejects invalid explicit money before local mutation or delegation', async t => {
  const { store, engine } = await fixture(t);
  const created = await engine.ingest(lead);
  const before = await store.snapshot();
  let delegated = 0;
  const delegate = new RecoveryEngine({ tenant, store: { markRecovered: async () => { delegated++; } } });
  for (const value of invalidMoney.filter(value => value !== null)) {
    await assert.rejects(engine.markRecovered(created.opportunity.id, { estimatedRecoveredValue: value }), /amount/i);
    await assert.rejects(delegate.markRecovered(created.opportunity.id, { estimatedRecoveredValue: value }), /amount/i);
    assert.deepEqual(await store.snapshot(), before);
  }
  assert.equal(delegated, 0);
  const result = await engine.markRecovered(created.opportunity.id, { estimatedRecoveredValue: '0' });
  assert.equal(result.attribution.estimatedRecoveredValue, 0);
});

test('accepted event inputs cannot be mutated while waiting for prior ingestion', async t => {
  const { store, engine } = await fixture(t);
  const event = { ...lead, contact: { ...lead.contact }, estimatedOpportunityValue: 5 };
  const result = engine.ingest(event);
  event.estimatedOpportunityValue = -10;
  event.contact.phone = {};
  const created = await result;
  assert.equal(created.opportunity.estimatedOpportunityValue, 5);
  assert.equal((await store.getContact(created.opportunity.contactKey)).phone, lead.contact.phone);
});


test('omitted and explicitly undefined dates are defaulted before storage', async t => {
  const { engine } = await fixture(t);
  const result = await engine.ingest({ ...lead, occurredAt: undefined });
  assert.ok(Number.isFinite(Date.parse(result.event.occurredAt)));
  assert.ok(result.actions.every(action => Number.isFinite(Date.parse(action.dueAt))));
});

test('invalid default estimates and unrepresentable action dates fail before receipt', async t => {
  const { store, engine } = await fixture(t);
  const before = await store.snapshot();
  await assert.rejects(engine.ingest({ ...lead, occurredAt: 8640000000000000 }), /dueAt/);
  const badConfig = new RecoveryEngine({ store, tenant: { ...tenant, economics: { defaultAverageJobValue: -1 } } });
  await assert.rejects(badConfig.ingest(lead), /amount/);
  assert.deepEqual(await store.snapshot(), before);
});


test('nullable optional estimate fields and bookingId remain compatible with omitted values', async t => {
  const { store, engine } = await fixture(t);
  const created = await engine.ingest({ ...lead, estimateAmount: null, estimatedOpportunityValue: null });
  assert.equal(created.opportunity.estimatedOpportunityValue, 500);
  await engine.ingest({ type: 'booking_confirmed', opportunityId: created.opportunity.id, bookingId: null, estimatedRecoveredValue: null });
  assert.equal((await store.snapshot()).attribution[created.opportunity.id].estimatedRecoveredValue, 500);
});
