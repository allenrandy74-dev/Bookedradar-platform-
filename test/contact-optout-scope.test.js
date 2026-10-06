import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RecoveryStore } from '../src/recovery/store.js';
import { RecoveryEngine, recipientSuppressed, contactWithRecipientSuppression } from '../src/recovery/engine.js';
import { ActionDispatcher } from '../src/integrations/dispatcher.js';

const phone = '+14095550100';
const otherPhone = '+14095550101';
const tenant = tenantId => ({
  tenantId,
  policies: { sms: { allowTransactionalWhenInbound: true } },
  playbooks: { synthetic: ['sms', 'email', 'phone', 'human_task', 'human_alert'].map(channel => ({
    channel, template: 'synthetic', purpose: 'transactional', offsetMs: 0,
  })) },
});
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'br-optout-scope-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new RecoveryStore(path.join(dir, 'recovery.json'));
  await store.load();
  const engine = new RecoveryEngine({ store, tenant: tenant('t1') });
  const secondEngine = new RecoveryEngine({ store, tenant: tenant('t2') });
  const seed = (selected = engine, contactPhone = phone, extra = {}) => selected.ingest({
    type: 'synthetic', contact: { phone: contactPhone, email: `${contactPhone.slice(1)}@example.test`, ...extra },
  });
  return { store, engine, secondEngine, seed };
}
const contactActions = (state, key) => Object.values(state.actions).filter(action => action.contactKey === key);

for (const scoped of [true, false]) {
  test(`${scoped ? 'opportunity' : 'contact'} opt-out suppresses and cancels every contact opportunity within its tenant`, async t => {
    const { store, engine, secondEngine, seed } = await fixture(t);
    const first = await seed();
    const sibling = await seed();
    const unrelated = await seed(engine, otherPhone);
    const foreign = await seed(secondEngine);
    await store.patchAction(first.actions[0].id, {
      status: 'processing', claimedBy: 'worker', claimedAt: '2026-10-01T10:00:00Z', claimExpiresAt: '2099-10-01T10:00:00Z',
    });
    const before = await store.snapshot();
    const result = await engine.ingest({
      idempotencyKey: 'stop-1', type: 'contact_opted_out',
      ...(scoped ? { opportunityId: first.opportunity.id } : { contactKey: phone }),
    });
    assert.equal(result.contactKey, `t1:${phone}`);
    assert.equal(result.suppressed, true);
    assert.equal(result.cancelledActions, first.actions.length + sibling.actions.length);
    const state = await store.snapshot();
    assert.equal(state.contacts[`t1:${phone}`].optedOut, true);
    assert.equal(state.contacts[`t1:${phone}`].suppressed, true);
    for (const action of contactActions(state, `t1:${phone}`)) {
      assert.equal(action.status, 'cancelled');
      assert.equal(action.cancelledReason, 'contact_opted_out');
      assert.equal(action.claimedBy, null);
      assert.equal(action.claimExpiresAt, null);
    }
    assert.equal(state.opportunities[first.opportunity.id].status, scoped ? 'closed' : 'open');
    assert.equal(state.opportunities[sibling.opportunity.id].status, 'open');
    for (const record of [unrelated, foreign]) {
      assert.deepEqual(state.contacts[record.opportunity.contactKey], before.contacts[record.opportunity.contactKey]);
      assert.deepEqual(state.opportunities[record.opportunity.id], before.opportunities[record.opportunity.id]);
      for (const action of record.actions) assert.deepEqual(state.actions[action.id], before.actions[action.id]);
    }
    assert.equal(Object.values(state.contacts).filter(contact => contact.kind !== 'recipient_suppression').length, 3, 'no anonymous contact manufactured');
    const restarted = new RecoveryStore(store.filePath);
    assert.deepEqual(await restarted.snapshot(), state, 'suppression and cancellation survive reload');
  });
}

test('opt-out preserves completed, dispatching and reconciliation evidence and recovered outcomes', async t => {
  const { store, engine, seed } = await fixture(t);
  const seeded = await seed();
  const statuses = ['completed', 'dispatching', 'reconciliation_required', 'failed', 'blocked'];
  for (const [index, status] of statuses.entries()) await store.patchAction(seeded.actions[index].id, { status, providerResult: { id: `evidence-${index}` } });
  await store.patchOpportunity(seeded.opportunity.id, { status: 'closed', outcome: 'booking_confirmed', recovered: true, bookingId: 'booking-1' });
  const before = await store.snapshot();
  const result = await engine.ingest({ type: 'contact_opted_out', opportunityId: seeded.opportunity.id });
  assert.equal(result.cancelledActions, 0);
  const after = await store.snapshot();
  assert.deepEqual(after.actions, before.actions);
  assert.deepEqual(after.opportunities, before.opportunities);
  assert.equal(after.contacts[seeded.opportunity.contactKey].suppressed, true);
});

test('replay remains safe, repairs an older partial receipt and cannot switch identity', async t => {
  const { store, engine, seed } = await fixture(t);
  const seeded = await seed();
  const other = await seed(engine, otherPhone);
  const event = { idempotencyKey: 'legacy-stop', type: 'contact_opted_out', opportunityId: seeded.opportunity.id };
  await store.addEvent(event);
  await store.patchOpportunity(seeded.opportunity.id, { status: 'closed', outcome: 'contact_opted_out' });
  const repaired = await engine.ingest(event);
  assert.equal(repaired.duplicate, true);
  assert.equal(repaired.suppressed, true);
  assert.equal(repaired.cancelledActions, seeded.actions.length);
  const afterRepair = await store.snapshot();
  const replay = await engine.ingest(event);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.cancelledActions, 0);
  assert.deepEqual(await store.snapshot(), afterRepair);
  await assert.rejects(engine.ingest({ ...event, opportunityId: other.opportunity.id }), /event conflict/);
  assert.deepEqual(await store.snapshot(), afterRepair);
});

test('invalid and mismatched identities fail before any JSON event receipt or mutation', async t => {
  const { store, engine, secondEngine, seed } = await fixture(t);
  const seeded = await seed();
  const foreign = await seed(secondEngine);
  const invalid = [
    {},
    { opportunityId: 'missing' },
    { opportunityId: foreign.opportunity.id },
    { opportunityId: seeded.opportunity.id, tenantId: 't2' },
    { opportunityId: seeded.opportunity.id, contact: { tenantId: 't2' } },
    { opportunityId: seeded.opportunity.id, contactKey: otherPhone },
    { opportunityId: seeded.opportunity.id, contact: { contactKey: `t1:${otherPhone}` } },
    { opportunityId: seeded.opportunity.id, contact: { phone: otherPhone } },
    { opportunityId: seeded.opportunity.id, contact: { email: 'someone-else@example.test' } },
    { opportunityId: seeded.opportunity.id, contact: { externalId: 'someone-else' } },
    { contactKey: `t2:${phone}` },
    { contactKey: phone, contact: { phone: otherPhone } },
    { contactKey: phone, contact: { tenantId: 't2' } },
  ];
  const before = await store.snapshot();
  for (const [index, input] of invalid.entries()) {
    await assert.rejects(engine.ingest({ idempotencyKey: `invalid-${index}`, type: 'contact_opted_out', ...input }));
    assert.deepEqual(await store.snapshot(), before, `invalid input ${index} must not mutate`);
  }
});

test('receipt collisions cannot suppress another contact or tenant', async t => {
  const { store, engine, secondEngine, seed } = await fixture(t);
  const seeded = await seed();
  const foreign = await seed(secondEngine);
  await store.addEvent({ id: 'unrelated-event', idempotencyKey: 'unrelated-key', type: 'customer_replied', opportunityId: seeded.opportunity.id });
  await secondEngine.ingest({ id: 'foreign-stop', idempotencyKey: 'foreign-key', type: 'contact_opted_out', opportunityId: foreign.opportunity.id });
  const before = await store.snapshot();
  for (const identity of [{ idempotencyKey: 'unrelated-key' }, { id: 'unrelated-event', idempotencyKey: 'new-key' }]) {
    await assert.rejects(engine.ingest({ ...identity, type: 'contact_opted_out', opportunityId: seeded.opportunity.id }));
    assert.deepEqual(await store.snapshot(), before);
  }
  // Source keys are tenant-scoped: a different tenant's identical key cannot
  // block this legitimate STOP or change any of the other tenant's evidence.
  const stopped = await engine.ingest({ idempotencyKey: 'foreign-key', type: 'contact_opted_out', opportunityId: seeded.opportunity.id });
  assert.equal(stopped.suppressed, true);
  const after = await store.snapshot();
  assert.deepEqual(after.opportunities[foreign.opportunity.id], before.opportunities[foreign.opportunity.id]);
  assert.deepEqual(after.contacts[foreign.opportunity.contactKey], before.contacts[foreign.opportunity.contactKey]);
});

test('JSON durable suppression receipt survives cleanup interruption and is repairable after reload', async t => {
  const { store, engine, seed } = await fixture(t);
  const seeded = await seed();
  const event = { idempotencyKey: 'interrupted-stop', type: 'contact_opted_out', opportunityId: seeded.opportunity.id };
  store.patchAction = async () => { throw new Error('synthetic interruption before cancellation'); };
  await assert.rejects(engine.ingest(event), /synthetic interruption/);
  const restarted = new RecoveryStore(store.filePath);
  const partial = await restarted.snapshot();
  assert.equal(partial.contacts[seeded.opportunity.contactKey].suppressed, true);
  assert.ok(partial.eventKeys[JSON.stringify(["t1", event.idempotencyKey])]);
  const recovered = await new RecoveryEngine({ store: restarted, tenant: tenant('t1') }).ingest(event);
  assert.equal(recovered.cancelledActions, seeded.actions.length);
  assert.equal(recovered.duplicate, true);
  assert.ok((await restarted.snapshot()).eventKeys[JSON.stringify(["t1", event.idempotencyKey])]);
});

test('future intake and replies cannot clear persisted opt-out flags or dispatch', async t => {
  const { store, engine, seed } = await fixture(t);
  const first = await seed();
  await engine.ingest({ type: 'contact_opted_out', opportunityId: first.opportunity.id });
  const future = await seed(engine, phone, { optedOut: false, suppressed: false, transactionalSmsAllowed: true });
  assert.ok(future.actions.every(action => action.status === 'blocked' && action.blockedReason === 'contact_suppressed'));
  await engine.ingest({ type: 'customer_replied', opportunityId: future.opportunity.id, contact: { optedOut: false, suppressed: false } });
  assert.equal((await store.getContact(future.opportunity.contactKey)).suppressed, true);
  assert.equal((await store.getContact(future.opportunity.contactKey)).optedOut, true);
  let sends = 0;
  const adapter = { send: async () => { sends += 1; } };
  const dispatcher = new ActionDispatcher({ store, tenant: tenant('t1'), adapters: Object.fromEntries(['sms', 'email', 'phone', 'human_task', 'human_alert'].map(channel => [channel, adapter])) });
  await dispatcher.runOnce({ now: new Date('2099-01-01') });
  assert.equal(sends, 0);
});

test('contact-only opt-out can persist a new explicit identity without creating an opportunity', async t => {
  const { store, engine } = await fixture(t);
  const result = await engine.ingest({ type: 'contact_opted_out', contact: { externalId: 'crm:synthetic', phone, name: 'Synthetic' } });
  assert.equal(result.contactKey, 't1:crm:synthetic');
  assert.equal(result.cancelledActions, 0);
  const state = await store.snapshot();
  assert.equal(Object.keys(state.opportunities).length, 0);
  assert.equal(state.contacts[result.contactKey].phone, phone);
  assert.equal(state.contacts[result.contactKey].suppressed, true);
});

test('concurrent JSON replay keys cannot switch contacts, and failed ingestion does not stall later work', async t => {
  const { store, engine, seed } = await fixture(t);
  const first = await seed();
  const second = await seed(engine, otherPhone);
  const secondEngine = new RecoveryEngine({ store, tenant: tenant('t1') });
  const results = await Promise.allSettled([
    engine.ingest({ idempotencyKey: 'concurrent-stop', type: 'contact_opted_out', opportunityId: first.opportunity.id }),
    secondEngine.ingest({ idempotencyKey: 'concurrent-stop', type: 'contact_opted_out', opportunityId: second.opportunity.id }),
  ]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.match(results[1].reason.message, /event conflict/);
  const state = await store.snapshot();
  assert.equal(state.contacts[first.opportunity.contactKey].suppressed, true);
  assert.equal(state.contacts[second.opportunity.contactKey].suppressed, undefined);
  assert.ok(second.actions.every(action => state.actions[action.id].status === 'pending'));
  assert.equal((await secondEngine.ingest({ idempotencyKey: 'later-stop', type: 'contact_opted_out', opportunityId: second.opportunity.id })).suppressed, true);
});

test('ordinary JSON intake racing opt-out cannot clear suppression or leave scheduled contact work', async t => {
  const { store, engine, seed } = await fixture(t);
  const first = await seed();
  const [stopped, later] = await Promise.all([
    engine.ingest({ type: 'contact_opted_out', opportunityId: first.opportunity.id }),
    seed(engine, phone, { suppressed: false, optedOut: false }),
  ]);
  assert.equal(stopped.suppressed, true);
  assert.ok(later.actions.every(action => action.status === 'blocked'));
  assert.equal((await store.getContact(first.opportunity.contactKey)).suppressed, true);
  assert.ok(Object.values((await store.snapshot()).actions).every(action => ['cancelled', 'blocked'].includes(action.status)));
});

test('STOP by delivery phone suppresses CRM and corrected-ANI aliases, and future aliases inherit suppression', async t => {
  const { store, engine, secondEngine, seed } = await fixture(t);
  const crm = await engine.ingest({ type: 'synthetic', contact: { externalId: 'crm-123', phone, email: 'shared@example.test' } });
  const correctedAni = await engine.ingest({ type: 'synthetic', contactKey: otherPhone, contact: { phone } });
  const emailAlias = await engine.ingest({ type: 'synthetic', contact: { externalId: 'crm-email', phone: '+14095550102', email: 'SHARED@example.test' } });
  const foreign = await seed(secondEngine);
  const before = await store.snapshot();
  const result = await engine.ingest({ idempotencyKey: 'stop-actual-recipient', type: 'contact_opted_out', contactKey: `t1:${phone}`, contact: { phone }, source: 'twilio_sms' });
  const after = await store.snapshot();
  assert.equal(result.cancelledActions, crm.actions.length + correctedAni.actions.length);
  for (const alias of [crm, correctedAni]) {
    assert.equal(after.contacts[alias.opportunity.contactKey].suppressed, true);
    assert.ok(alias.actions.every(action => after.actions[action.id].status === 'cancelled'));
  }
  assert.deepEqual(after.contacts[emailAlias.opportunity.contactKey], before.contacts[emailAlias.opportunity.contactKey]);
  for (const action of emailAlias.actions) assert.deepEqual(after.actions[action.id], before.actions[action.id]);
  assert.equal(await recipientSuppressed(store, 't1', { phone: '+14095550102' }), false);
  assert.deepEqual(after.contacts[foreign.opportunity.contactKey], before.contacts[foreign.opportunity.contactKey]);
  for (const action of foreign.actions) assert.deepEqual(after.actions[action.id], before.actions[action.id]);
  const future = await engine.ingest({ type: 'synthetic', contact: { externalId: 'brand-new-crm-alias', phone, suppressed: false, optedOut: false } });
  assert.ok(future.actions.every(action => action.status === 'blocked' && action.blockedReason === 'contact_suppressed'));
  assert.equal(await recipientSuppressed(store, 't1', { phone: '+1 (409) 555-0100' }), true);
  assert.equal(await recipientSuppressed(store, 't2', { phone }), false);
  assert.equal(await recipientSuppressed(store, 't1', { email: ' shared@EXAMPLE.test ' }), false);
});

test('durable recipient helper protects direct-import aliases and rejects foreign or invalid recipient identities', async t => {
  const { store, engine } = await fixture(t);
  await engine.ingest({ type: 'contact_opted_out', contact: { phone } });
  await store.upsertContact('t1:imported-alias', { tenantId: 't1', contactKey: 't1:imported-alias', phone, suppressed: false, optedOut: false });
  const reloaded = new RecoveryStore(store.filePath);
  const imported = await reloaded.getContact('t1:imported-alias');
  const protectedContact = await contactWithRecipientSuppression(reloaded, 't1', imported);
  assert.equal(protectedContact.suppressed, true);
  assert.equal(protectedContact.optedOut, true);
  assert.equal(imported.suppressed, false, 'lookup must not mutate imported contact');
  for (const invalid of [{ phone: '14095550100' }, { phone: 'phone' }, { email: 'invalid' }, { email: 'missing@domain' }]) {
    assert.equal(await recipientSuppressed(reloaded, 't1', invalid), false);
  }
  await assert.rejects(recipientSuppressed(reloaded, 't1', { tenantId: 't2', phone }), /tenant mismatch/);
  assert.equal(await recipientSuppressed(reloaded, 't2', { phone }), false);
});

test('STOP recipient tombstone does not overwrite a stale phone-shaped key holding a different corrected contact', async t => {
  const { store, engine } = await fixture(t);
  const corrected = await engine.ingest({ type: 'synthetic', contactKey: phone, contact: { phone: otherPhone } });
  const actual = await engine.ingest({ type: 'synthetic', contact: { externalId: 'actual-stop-recipient', phone } });
  const before = await store.snapshot();
  const result = await engine.ingest({ idempotencyKey: 'stop-stale-shaped-key', type: 'contact_opted_out', contactKey: `t1:${phone}`, contact: { phone }, source: 'twilio_sms' });
  assert.equal(result.cancelledActions, actual.actions.length);
  assert.equal(await recipientSuppressed(store, 't1', { phone }), true);
  assert.equal(await recipientSuppressed(store, 't1', { phone: otherPhone }), false);
  const state = await store.snapshot();
  assert.deepEqual(state.contacts[corrected.opportunity.contactKey], before.contacts[corrected.opportunity.contactKey]);
  for (const action of corrected.actions) assert.deepEqual(state.actions[action.id], before.actions[action.id]);
  assert.equal(state.contacts[actual.opportunity.contactKey].suppressed, true);
  assert.equal((await engine.ingest({ idempotencyKey: 'stop-stale-shaped-key', type: 'contact_opted_out', contactKey: `t1:${phone}`, contact: { phone }, source: 'twilio_sms' })).duplicate, true);
});

test('phone-key-only opt-out resolves recipient aliases without a canonical contact row', async t => {
  const { store, engine } = await fixture(t);
  const crm = await engine.ingest({ type: 'synthetic', contact: { externalId: 'crm-phone-only', phone } });
  const result = await engine.ingest({ type: 'contact_opted_out', contactKey: phone });
  assert.equal(result.cancelledActions, crm.actions.length);
  assert.equal((await store.getContact(crm.opportunity.contactKey)).suppressed, true);
  assert.equal(await recipientSuppressed(store, 't1', { phone }), true);
});

test('ordinary contact intake cannot rewrite the reserved suppression tombstone identity', async t => {
  const { store, engine } = await fixture(t);
  await engine.ingest({ type: 'contact_opted_out', contact: { phone } });
  const marker = Object.values((await store.snapshot()).contacts).find(contact => contact.kind === 'recipient_suppression');
  assert.ok(marker);
  await assert.rejects(engine.ingest({ type: 'synthetic', contactKey: marker.contactKey,
    contact: { kind: 'ordinary', suppressed: false, optedOut: false } }), /Reserved recipient suppression identity/);
  assert.equal(await recipientSuppressed(store, 't1', { phone }), true);
  assert.deepEqual(await store.getContact(marker.contactKey), marker);
});

test('generic contact opt-out uses its target recipients without transitive alias expansion', async t => {
  const { store, engine } = await fixture(t);
  const target = await engine.ingest({ type: 'synthetic', contact: { externalId: 'target', phone, email: 'office@example.test' } });
  await engine.ingest({ type: 'synthetic', contact: { externalId: 'shared-office', phone: otherPhone, email: 'office@example.test' } });
  const remote = await engine.ingest({ type: 'synthetic', contact: { externalId: 'second-phone-only', phone: otherPhone, email: 'unrelated@example.test' } });
  const before = await store.snapshot();
  await engine.ingest({ type: 'contact_opted_out', opportunityId: target.opportunity.id });
  assert.equal(await recipientSuppressed(store, 't1', { phone: otherPhone }), false);
  assert.equal(await recipientSuppressed(store, 't1', { email: 'unrelated@example.test' }), false);
  const after = await store.snapshot();
  assert.deepEqual(after.contacts[remote.opportunity.contactKey], before.contacts[remote.opportunity.contactKey]);
  for (const action of remote.actions) assert.deepEqual(after.actions[action.id], before.actions[action.id]);
});
