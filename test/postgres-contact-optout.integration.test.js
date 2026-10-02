import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PostgresRecoveryStore } from '../src/postgres-recovery-store.js';
import { RecoveryEngine, recipientSuppressed } from '../src/recovery/engine.js';

const connectionString = process.env.POSTGRES_TEST_URL;
const phone = '+14095550100';
const otherPhone = '+14095550101';
const tenant = tenantId => ({
  tenantId,
  policies: { sms: { allowTransactionalWhenInbound: true } },
  playbooks: { synthetic: ['sms', 'email', 'phone', 'human_task', 'human_alert'].map(channel => ({
    channel, template: 'synthetic', purpose: 'transactional', offsetMs: 0,
  })) },
});

test('real Postgres: contact opt-out scope, replay and atomicity', { skip: !connectionString }, async t => {
  const url = new URL(connectionString);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.equal(url.pathname, '/bookedradar_test');
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString, max: 10 });
  let sequence = 0;
  const fixture = async () => {
    const config = tenant(`optout-${++sequence}`);
    const otherConfig = tenant(`${config.tenantId}-other`);
    const store = new PostgresRecoveryStore(pool, config.tenantId);
    const otherStore = new PostgresRecoveryStore(pool, otherConfig.tenantId);
    const engine = new RecoveryEngine({ store, tenant: config });
    const otherEngine = new RecoveryEngine({ store: otherStore, tenant: otherConfig });
    const seed = (selected = engine, contactPhone = phone, extra = {}) => selected.ingest({
      type: 'synthetic', occurredAt: '2026-01-01T10:00:00Z',
      contact: { phone: contactPhone, email: `${contactPhone.slice(1)}@example.test`, ...extra },
    });
    return { config, store, otherStore, engine, otherEngine, seed };
  };
  try {
    await pool.query('DROP SCHEMA IF EXISTS bookedradar CASCADE');
    await pool.query(await fs.readFile(new URL('../db/postgres-schema.sql', import.meta.url), 'utf8'));

    await t.test('30 concurrent replays suppress one tenant and every same-contact opportunity durably', async () => {
      const { config, store, otherStore, engine, otherEngine, seed } = await fixture();
      const first = await seed();
      const sibling = await seed();
      const unrelated = await seed(engine, otherPhone);
      await seed(otherEngine);
      const foreignBefore = await otherStore.snapshot();
      const claims = await store.claimDueActions({ now: new Date(), workerId: 'synthetic', limit: 50 });
      const claim = claims.find(action => action.contactKey === first.opportunity.contactKey);
      assert.ok(claim, 'exercise cancellation of a target-contact claim regardless of due-time ties');
      const before = await store.snapshot();
      const event = { type: 'contact_opted_out', idempotencyKey: 'shared-stop-key', opportunityId: first.opportunity.id };
      const results = await Promise.all(Array.from({ length: 30 }, () => engine.ingest(event)));
      assert.equal(results.filter(result => !result.duplicate).length, 1);
      assert.equal(results.filter(result => result.duplicate).length, 29);
      assert.equal(results.reduce((sum, result) => sum + result.cancelledActions, 0), first.actions.length + sibling.actions.length);
      const state = await new PostgresRecoveryStore(pool, config.tenantId).snapshot();
      assert.equal(state.contacts[first.opportunity.contactKey].suppressed, true);
      assert.equal(state.contacts[first.opportunity.contactKey].optedOut, true);
      assert.equal(state.opportunities[first.opportunity.id].status, 'closed');
      assert.equal(state.opportunities[sibling.opportunity.id].status, 'open');
      assert.equal(state.events.filter(event => event.type === 'contact_opted_out').length, 1);
      for (const action of Object.values(state.actions).filter(action => action.contactKey === first.opportunity.contactKey)) {
        assert.equal(action.status, 'cancelled');
        assert.equal(action.cancelledReason, 'contact_opted_out');
        assert.equal(action.claimedBy, null);
      }
      for (const action of unrelated.actions) assert.deepEqual(state.actions[action.id], before.actions[action.id]);
      assert.deepEqual(await otherStore.snapshot(), foreignBefore);
      await assert.rejects(store.finishClaim(claim.id, claim, { status: 'completed' }), /stale_recovery_claim/);
      const future = await seed(engine, phone, { suppressed: false, optedOut: false });
      assert.ok(future.actions.every(action => action.status === 'blocked' && action.blockedReason === 'contact_suppressed'));
      assert.equal((await engine.ingest(event)).duplicate, true);
    });

    await t.test('contact-only opt-out isolates the same provider message ID using production tenant-qualified keys', async () => {
      const { store, otherStore, engine, otherEngine, seed } = await fixture();
      const first = await seed();
      const sibling = await seed();
      const other = await seed(otherEngine);
      const messageSid = `SM${'a'.repeat(32)}`;
      // Match the signed Twilio STOP route. recovery_events.idempotency_key is
      // globally unique; the source supplies the tenant-qualified receipt key.
      const eventFor = tenantId => ({ type: 'contact_opted_out',
        idempotencyKey: `twilio-optout:${tenantId}:${messageSid}`,
        contactKey: `${tenantId}:${phone}`, contact: { phone }, source: 'twilio_sms' });
      const foreignBefore = await otherStore.snapshot();
      const event = eventFor(store.tenantId);
      const result = await engine.ingest(event);
      assert.equal(result.cancelledActions, first.actions.length + sibling.actions.length);
      assert.equal(result.opportunity, undefined);
      assert.equal((await store.getOpportunity(first.opportunity.id)).status, 'open');
      assert.deepEqual(await otherStore.snapshot(), foreignBefore);
      const firstTenantAfter = await store.snapshot();
      const foreignEvent = eventFor(otherStore.tenantId);
      const foreignResult = await otherEngine.ingest(foreignEvent);
      assert.equal(foreignResult.duplicate, undefined);
      assert.equal(foreignResult.cancelledActions, other.actions.length);
      assert.equal((await otherStore.getContact(other.opportunity.contactKey)).suppressed, true);
      assert.deepEqual(await store.snapshot(), firstTenantAfter);
      assert.equal((await engine.ingest(event)).duplicate, true);
      assert.equal((await otherEngine.ingest(foreignEvent)).duplicate, true);
      assert.equal((await store.snapshot()).events.filter(item => item.type === 'contact_opted_out').length, 1);
      assert.equal((await otherStore.snapshot()).events.filter(item => item.type === 'contact_opted_out').length, 1);
    });

    await t.test('reusing a globally unique raw receipt key fails atomically without cross-tenant suppression', async () => {
      const { store, otherStore, engine, otherEngine, seed } = await fixture();
      await seed();
      const foreign = await seed(otherEngine);
      const event = { type: 'contact_opted_out', idempotencyKey: 'unqualified-shared-source-id',
        contactKey: phone, contact: { phone }, source: 'twilio_sms' };
      await engine.ingest(event);
      const firstBefore = await store.snapshot();
      const foreignBefore = await otherStore.snapshot();
      await assert.rejects(otherEngine.ingest(event), error => {
        assert.equal(error.code, '23505');
        assert.equal(error.constraint, 'recovery_events_idempotency_key_key');
        return true;
      });
      assert.deepEqual(await store.snapshot(), firstBefore);
      assert.deepEqual(await otherStore.snapshot(), foreignBefore);
      assert.equal((await otherStore.getContact(foreign.opportunity.contactKey)).suppressed, undefined);
      assert.equal(await recipientSuppressed(otherStore, otherStore.tenantId, { phone }), false);
      assert.ok(foreign.actions.every(action => foreignBefore.actions[action.id].status === 'pending'));
    });

    await t.test('invalid identities, cross-tenant targets and conflicting replays leave no receipt or mutations', async () => {
      const { config, store, otherStore, engine, otherEngine, seed } = await fixture();
      const first = await seed();
      const second = await seed(engine, otherPhone);
      const foreign = await seed(otherEngine);
      const event = { type: 'contact_opted_out', idempotencyKey: 'valid-stop', opportunityId: first.opportunity.id };
      await engine.ingest(event);
      const before = await store.snapshot();
      const foreignBefore = await otherStore.snapshot();
      const invalid = [
        { type: 'contact_opted_out' },
        { ...event, opportunityId: second.opportunity.id },
        { ...event, idempotencyKey: 'bad-phone', contact: { phone: otherPhone } },
        { ...event, idempotencyKey: 'bad-email', contact: { email: 'wrong@example.test' } },
        { ...event, idempotencyKey: 'bad-key', contactKey: otherPhone },
        { ...event, idempotencyKey: 'bad-tenant', tenantId: `${config.tenantId}-other` },
        { ...event, idempotencyKey: 'bad-contact-tenant', contact: { tenantId: `${config.tenantId}-other` } },
        { ...event, idempotencyKey: 'foreign-opportunity', opportunityId: foreign.opportunity.id },
        { type: 'contact_opted_out', idempotencyKey: 'foreign-contact', contactKey: foreign.opportunity.contactKey },
      ];
      for (const input of invalid) {
        await assert.rejects(engine.ingest(input));
        assert.deepEqual(await store.snapshot(), before);
        assert.deepEqual(await otherStore.snapshot(), foreignBefore);
      }
    });

    await t.test('database cancellation failure rolls back suppression, closure and receipt; retry succeeds', async () => {
      const { store, engine, seed } = await fixture();
      const first = await seed();
      await seed();
      const before = await store.snapshot();
      const event = { type: 'contact_opted_out', idempotencyKey: 'rollback-stop', opportunityId: first.opportunity.id };
      await pool.query("ALTER TABLE bookedradar.recovery_actions ADD CONSTRAINT reject_optout_cancellation CHECK (payload->>'cancelledReason' IS DISTINCT FROM 'contact_opted_out') NOT VALID");
      try {
        await assert.rejects(engine.ingest(event), /reject_optout_cancellation/);
        assert.deepEqual(await store.snapshot(), before);
      } finally {
        await pool.query('ALTER TABLE bookedradar.recovery_actions DROP CONSTRAINT reject_optout_cancellation');
      }
      const retry = await engine.ingest(event);
      assert.equal(retry.duplicate, undefined);
      assert.equal(retry.cancelledActions, 10);
      assert.equal((await store.getContact(first.opportunity.contactKey)).suppressed, true);
      assert.equal((await engine.ingest(event)).duplicate, true);
    });

    await t.test('recipient tombstones survive alias imports and block the final dispatch fence', async () => {
      const { config, store, otherStore, engine, seed } = await fixture();
      const crm = await seed(engine, phone, { externalId: 'crm-recipient' });
      const corrected = await engine.ingest({ type: 'synthetic', contactKey: otherPhone, contact: { phone } });
      const result = await engine.ingest({ type: 'contact_opted_out', contactKey: `${config.tenantId}:${phone}`, contact: { phone }, source: 'twilio_sms' });
      assert.equal(result.cancelledActions, crm.actions.length + corrected.actions.length);
      assert.equal((await store.getContact(crm.opportunity.contactKey)).suppressed, true);
      assert.equal((await store.getContact(corrected.opportunity.contactKey)).suppressed, true);
      const imported = await seed(engine, phone, { externalId: 'new-imported-recipient', suppressed: false, optedOut: false });
      assert.ok(imported.actions.every(action => action.status === 'blocked'));
      await store.upsertContact(imported.opportunity.contactKey, { suppressed: false, optedOut: false });
      const contact = await store.getContact(imported.opportunity.contactKey);
      assert.equal(await recipientSuppressed(new PostgresRecoveryStore(pool, config.tenantId), config.tenantId, contact), true);
      assert.equal(await recipientSuppressed(otherStore, otherStore.tenantId, { phone }), false);
      const action = await store.scheduleAction({ tenantId: config.tenantId, opportunityId: imported.opportunity.id,
        contactKey: imported.opportunity.contactKey, channel: 'sms', purpose: 'transactional',
        expectedRecipient: phone, template: 'synthetic', dueAt: new Date().toISOString() });
      const [claim] = await store.claimDueActions({ now: new Date(), workerId: 'alias-import', limit: 1 });
      assert.equal(claim.id, action.id);
      const fenced = await store.beginDispatch(action.id, claim, new Date(), config);
      assert.equal(fenced.status, 'blocked');
      assert.equal(fenced.blockedReason, 'contact_suppressed');
    });

    await t.test('dispatching evidence survives opt-out while other claims are cancelled', async () => {
      const { store, engine, seed } = await fixture();
      const first = await seed();
      const [claim] = await store.claimDueActions({ now: new Date(), workerId: 'send-intent', limit: 1 });
      await store.beginDispatch(claim.id, claim);
      const before = await store.snapshot();
      const result = await engine.ingest({ type: 'contact_opted_out', opportunityId: first.opportunity.id });
      assert.equal(result.cancelledActions, first.actions.length - 1);
      const state = await store.snapshot();
      assert.equal(state.contacts[first.opportunity.contactKey].suppressed, true);
      assert.deepEqual(state.actions[claim.id], before.actions[claim.id]);
      assert.equal((await store.reconciliationActions()).length, 1);
    });
  } finally {
    await pool.query('DROP SCHEMA IF EXISTS bookedradar CASCADE');
    await pool.end();
  }
});
