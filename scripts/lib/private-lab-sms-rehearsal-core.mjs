import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PostgresRecoveryStore } from '../../src/postgres-recovery-store.js';
import { RecoveryEngine, recipientSuppressed } from '../../src/recovery/engine.js';
import { queueCallerText } from '../../src/caller-text-queue.js';
import { queueSmsReply } from '../../src/sms-reply-queue.js';

// No server, dispatcher, provider, adapter, route, configuration file or DDL.
// This module exercises low-level persistence with ephemeral in-memory policies.
// A passing result proves neither provider acceptance nor SMS delivery.
export const TABLE_KEYS = Object.freeze({
  recovery_event_keys: 'event_key', recovery_actions: 'action_id',
  recovery_attribution: 'opportunity_id', recovery_opportunities: 'opportunity_id',
  recovery_contacts: 'contact_key', recovery_events: 'event_id',
});
export const LIMITS = Object.freeze({ rows: 160, queries: 12000, workMs: 120000, cleanupMs: 60000 });
const FIXTURE_TENANT = /^synthetic-sms-rehearsal-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-[ab]$/;
const PHONE = '+12025550101'; // Reserved fictional 555-0100 through 555-0199 range.

export async function verifyDisabledSmsEntryPoints(env) {
  assert.equal(env.DISPATCH_ENABLED, 'false', 'global_dispatch_must_stay_disabled');
  const forbidden = new Proxy({}, { get() { throw new Error('disabled_gate_touched_dependency'); } });
  const tenant = { tenantId: 'synthetic-gate-only', commercial: { dispatchMode: 'live' },
    features: { callerTexting: true, twoWaySms: true }, integrations: { sms: { enabled: true } } };
  for (const result of [
    await queueCallerText({ tenant, env, store: forbidden, state: forbidden }),
    await queueSmsReply({ tenant, env, store: forbidden, generate: () => { throw new Error('disabled_gate_generated'); } }),
  ]) assert.deepEqual(result, { queued: false, reason: 'global_dispatch_disabled' });
  return true;
}

// The deletion allowlist is captured BEFORE each attempted INSERT, including
// generated IDs whose transaction later fails or whose COMMIT response is lost.
// This wrapper also restricts the existing store's SQL to owned fixture tenants.
export function createFixturePool(pool, tenantIds) {
  assert.equal(tenantIds.length, 2);
  assert.equal(new Set(tenantIds).size, 2);
  for (const id of tenantIds) assert.match(id, FIXTURE_TENANT);
  const owned = new Set(tenantIds), started = Date.now();
  const allowlist = new Map(tenantIds.map(id => [id, new Map(Object.keys(TABLE_KEYS).map(table => [table, new Map()]))]));
  let queries = 0, rows = 0, fault = null;
  function inspect(sql, values = []) {
    if (sql === 'ROLLBACK') return;
    assert.ok(Date.now() - started < LIMITS.workMs, 'fixture_time_limit');
    assert.ok(++queries <= LIMITS.queries, 'fixture_query_limit');
    if (/^(?:BEGIN(?: ISOLATION LEVEL REPEATABLE READ READ ONLY)?|COMMIT)$/.test(sql) ||
        /^SET LOCAL (?:lock_timeout|statement_timeout)='(?:5|15)s'$/.test(sql)) return;
    if (sql === "SELECT pg_advisory_xact_lock(hashtext('br_recovery'),hashtext($1))") {
      assert.ok(owned.has(values[0]), 'fixture_foreign_tenant'); return;
    }
    const insert = sql.match(/^INSERT INTO bookedradar\.(\w+)(?: AS existing)?\s*\(([^)]+)\)/);
    if (insert) {
      const [, table, columns] = insert, key = TABLE_KEYS[table];
      assert.ok(key, 'fixture_unexpected_table');
      const fields = columns.split(',').map(x => x.trim());
      const tenantId = values[fields.indexOf('tenant_id')], id = values[fields.indexOf(key)];
      assert.ok(owned.has(tenantId), 'fixture_foreign_tenant');
      assert.ok(typeof id === 'string' && id.length > 0 && id.length <= 300, 'fixture_identity_required');
      const ids = allowlist.get(tenantId).get(table);
      if (!ids.has(id)) {
        assert.ok(rows < LIMITS.rows, 'fixture_row_limit');
        ids.set(id, table === 'recovery_event_keys' ? values[fields.indexOf('event_id')] : null); rows++;
      }
      if (fault === table) { fault = null; throw new Error('synthetic_insert_failure'); }
      return;
    }
    const read = sql.match(/^SELECT [\s\S]+ FROM bookedradar\.(\w+) WHERE tenant_id=\$1 ORDER BY /);
    if (read && TABLE_KEYS[read[1]]) { assert.ok(owned.has(values[0]), 'fixture_foreign_tenant'); return; }
    if (sql === 'DELETE FROM bookedradar.recovery_event_keys WHERE tenant_id=$1') {
      assert.ok(owned.has(values[0]), 'fixture_foreign_tenant'); return;
    }
    throw new Error('fixture_unexpected_query');
  }
  return {
    allowlist,
    stats: () => ({ attemptedFixtureRows: rows, storeQueries: queries }),
    failNextActionInsert() { assert.equal(fault, null); fault = 'recovery_actions'; },
    faultCleared: () => fault === null,
    pool: { async connect() {
      const client = await pool.connect();
      return { query(sql, values) { inspect(sql, values); return client.query(sql === "SET LOCAL statement_timeout='15s'" ? "SET LOCAL statement_timeout='5s'" : sql, values); }, release() { client.release(); } };
    } },
  };
}

async function namespaceCount(client, tenantId) {
  let count = 0;
  for (const table of Object.keys(TABLE_KEYS)) {
    const result = await client.query(`SELECT count(*)::int AS n FROM bookedradar.${table} WHERE tenant_id=$1`, [tenantId]);
    count += Number(result.rows[0].n);
  }
  return count;
}

export async function cleanupFixtures(pool, allowlist) {
  const started = Date.now(), client = await pool.connect();
  const query = (sql, values) => {
    assert.ok(Date.now() - started < LIMITS.cleanupMs, 'fixture_cleanup_time_limit');
    return client.query(sql, values);
  };
  let deleted = 0;
  try {
    await query('BEGIN');
    await query("SET LOCAL lock_timeout='5s'");
    await query("SET LOCAL statement_timeout='5s'");
    for (const [tenantId, tables] of allowlist) {
      assert.match(tenantId, FIXTURE_TENANT);
      await query("SELECT pg_advisory_xact_lock(hashtext('br_recovery'),hashtext($1))", [tenantId]);
      for (const [table, key] of Object.entries(TABLE_KEYS)) {
        const ids = tables.get(table);
        if (!ids?.size) continue;
        // The tenant AND exact generated/attempted primary keys must match.
        // Event keys additionally require their recorded event IDs to match.
        const result = table === 'recovery_event_keys'
          ? await query(`DELETE FROM bookedradar.${table} WHERE tenant_id=$1 AND (event_key,event_id) IN (SELECT * FROM unnest($2::text[],$3::text[]))`, [tenantId, [...ids.keys()], [...ids.values()]])
          : await query(`DELETE FROM bookedradar.${table} WHERE tenant_id=$1 AND ${key}=ANY($2::text[])`, [tenantId, [...ids.keys()]]);
        deleted += result.rowCount;
      }
      assert.equal(await namespaceCount({ query }, tenantId), 0, 'synthetic_cleanup_incomplete');
    }
    await query('COMMIT');
    return { syntheticRowsRemaining: 0, deletedFixtureRows: deleted };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {}); throw error;
  } finally { client.release(); }
}

export function syntheticSmsTenant(tenantId) {
  return { tenantId, features: { rehearsalSeed: false },
    // A nonempty playbook creates the opportunity. Its disabled feature prevents
    // seeding any action, so only the explicitly rehearsed queues create actions.
    playbooks: { phone_lead: [{ feature: 'rehearsalSeed', channel: 'human_task', purpose: 'service', template: 'synthetic-inert', offsetMs: 0 }] },
    policies: { sms: { allowTransactionalWhenInbound: false } } };
}

export async function runSmsPersistenceRehearsal(pool, { onStart = () => {} } = {}) {
  const runId = randomUUID(), tenantIds = ['a', 'b'].map(suffix => `synthetic-sms-rehearsal-${runId}-${suffix}`);
  const fixture = createFixturePool(pool, tenantIds);
  const tenants = tenantIds.map(syntheticSmsTenant);
  const stores = tenantIds.map(id => new PostgresRecoveryStore(fixture.pool, id));
  const engines = stores.map((store, i) => new RecoveryEngine({ store, tenant: tenants[i] }));
  const [store, otherStore] = stores, [tenant, otherTenant] = tenants, [engine, otherEngine] = engines;
  let initialized = false, result, failure;
  try {
    // No writes or allowlist entries until both fresh random namespaces are empty.
    for (const id of tenantIds) assert.equal(await namespaceCount(pool, id), 0, 'fixture_namespace_not_empty');
    initialized = true;
    // Emit only generated IDs before the first write. SIGKILL or a lost database
    // can prevent finally cleanup; retain this marker for operator reconciliation.
    await onStart({ event: 'private_lab.sms_database_rehearsal_started', runId, fixtureTenantIds: [...tenantIds],
      interruptionCleanupGuaranteed: false, providerCalls: 0 });
    const seed = (targetEngine, key, phone = PHONE) => targetEngine.ingest({
      idempotencyKey: `${runId}:seed:${key}`, type: 'phone_lead',
      contact: { externalId: key, phone, transactionalSmsAllowed: true }, metadata: { callId: `${runId}:${key}` },
    });
    const lead = await seed(engine, 'primary'), other = await seed(otherEngine, 'other');
    const caller = { tenantId: tenant.tenantId, callId: `${runId}:primary`, toolCallId: 'tool-primary',
      callerRequested: true, confirmedCallbackNumber: PHONE, to: PHONE, content: 'Synthetic database-only caller text; never deliver.',
      contactKey: lead.opportunity.contactKey, opportunityId: lead.opportunity.id };
    const reply = { tenantId: tenant.tenantId, messageSid: `SM${runId.replaceAll('-', '')}`,
      recipient: PHONE, content: 'Synthetic database-only SMS reply; never deliver.',
      contactKey: caller.contactKey, opportunityId: caller.opportunityId };
    async function concurrentOnce(fn) {
      // Wait for EVERY transaction to settle before assertions/cleanup, even on a failure.
      const outcomes = await Promise.allSettled(Array.from({ length: 8 }, fn));
      assert.ok(outcomes.every(x => x.status === 'fulfilled'), 'fixture_concurrent_transaction_failed');
      const values = outcomes.map(x => x.value);
      assert.equal(values.filter(x => x.queued).length, 1);
      assert.equal(values.filter(x => x.duplicate).length, 7);
      return values.find(x => x.queued).actionId;
    }
    const callerId = await concurrentOnce(() => store.queueCallerTextOnce(caller, tenant));
    const replyId = await concurrentOnce(() => store.queueSmsReplyOnce(reply, tenant));
    const restarted = new PostgresRecoveryStore(fixture.pool, tenant.tenantId);
    assert.equal((await restarted.queueCallerTextOnce(caller, tenant)).duplicate, true);
    assert.equal((await restarted.queueSmsReplyOnce(reply, tenant)).duplicate, true);
    assert.equal((await store.queueCallerTextOnce({ ...caller, content: 'Changed synthetic request' }, tenant)).reason, 'caller_text_request_conflict');
    const queued = await store.snapshot();
    assert.equal(Object.keys(queued.actions).length, 2);
    assert.equal(queued.events.filter(x => x.type === 'caller_text_queued').length, 1);
    assert.equal(queued.events.filter(x => x.type === 'sms_reply_queued').length, 1);

    // Fail after receipt insertion but before action insertion. No DDL, triggers,
    // provider or connection sabotage: the normal store transaction must roll back.
    for (const [kind, request, queue] of [
      ['caller', { ...caller, toolCallId: 'tool-rollback' }, r => store.queueCallerTextOnce(r, tenant)],
      ['reply', { ...reply, messageSid: `MM${runId.replaceAll('-', '')}` }, r => store.queueSmsReplyOnce(r, tenant)],
    ]) {
      const before = await store.snapshot(); fixture.failNextActionInsert();
      await assert.rejects(queue(request), /synthetic_insert_failure/, `${kind}_rollback_fault`);
      assert.equal(fixture.faultCleared(), true);
      assert.deepEqual(await store.snapshot(), before, `${kind}_atomic_rollback`);
      assert.equal((await queue(request)).queued, true, `${kind}_rollback_retry`);
    }

    // Same recipient and provider-style identity are legal in an unrelated fixture
    // tenant. Foreign reads are empty; attempted cross-tenant writes are rejected.
    assert.equal(await otherStore.getContact(caller.contactKey), null);
    assert.equal(await otherStore.getOpportunity(caller.opportunityId), null);
    await assert.rejects(store.queueCallerTextOnce({ ...caller, tenantId: otherTenant.tenantId }, tenant), /tenant_mismatch/);
    await assert.rejects(store.queueSmsReplyOnce({ ...reply, tenantId: otherTenant.tenantId }, tenant), /tenant_mismatch/);
    const otherRequest = { ...reply, tenantId: otherTenant.tenantId,
      contactKey: other.opportunity.contactKey, opportunityId: other.opportunity.id };
    assert.equal((await otherStore.queueSmsReplyOnce(otherRequest, otherTenant)).queued, true);
    const untouchedOther = await otherStore.snapshot();

    // Queue alias actions, claim the original pair, then STOP must cancel both
    // pending and processing actions and persist recipient-level suppression.
    const alias = await seed(engine, 'existing-alias');
    const aliasReply = { ...reply, messageSid: `SM${randomUUID().replaceAll('-', '')}`,
      contactKey: alias.opportunity.contactKey, opportunityId: alias.opportunity.id };
    assert.equal((await store.queueSmsReplyOnce(aliasReply, tenant)).queued, true);
    const claims = await store.claimDueActions({ workerId: `rehearsal-${runId}`, limit: 2 });
    assert.equal(claims.length, 2);
    assert.deepEqual(new Set(claims.map(x => x.id)), new Set([callerId, replyId]));
    const stop = { idempotencyKey: `${runId}:stop`, type: 'contact_opted_out', source: 'twilio_sms',
      contactKey: caller.contactKey, contact: { phone: PHONE } };
    const stopped = await engine.ingest(stop);
    assert.equal(stopped.cancelledActions, 5);
    const suppressed = await store.snapshot();
    assert.ok(Object.values(suppressed.actions).every(x => x.status === 'cancelled'));
    assert.equal((await store.getContact(caller.contactKey)).optedOut, true);
    assert.equal((await store.getContact(aliasReply.contactKey)).suppressed, true);
    assert.equal(await recipientSuppressed(store, tenant.tenantId, { phone: PHONE }), true);
    assert.equal((await engine.ingest(stop)).duplicate, true);
    assert.deepEqual(await store.snapshot(), suppressed, 'stop_replay_changed_state');
    for (const claim of claims) await assert.rejects(store.beginDispatch(claim.id, claim, new Date(), tenant), /stale_recovery_claim/);
    assert.equal((await store.queueCallerTextOnce({ ...caller, toolCallId: 'post-stop' }, tenant)).reason, 'contact_suppressed');
    assert.equal((await store.queueSmsReplyOnce({ ...reply, messageSid: `SM${randomUUID().replaceAll('-', '')}` }, tenant)).reason, 'contact_suppressed');
    const future = await seed(engine, 'future-import');
    const futureContact = await store.getContact(future.opportunity.contactKey);
    assert.equal(futureContact.suppressed, true); assert.equal(futureContact.optedOut, true);
    assert.equal((await store.queueSmsReplyOnce({ ...reply, messageSid: `SM${randomUUID().replaceAll('-', '')}`,
      contactKey: future.opportunity.contactKey, opportunityId: future.opportunity.id }, tenant)).reason, 'contact_suppressed');
    assert.deepEqual(await otherStore.snapshot(), untouchedOther, 'stop_leaked_to_other_tenant');
    assert.equal(await recipientSuppressed(otherStore, otherTenant.tenantId, { phone: PHONE }), false);

    // Final beginDispatch fences only. No adapter is ever constructed or called.
    // Each fence gets a fresh unsuppressed fictional recipient and exactly one claim.
    for (const [kind, phone] of [['recipient', '+12025550102'], ['suppression', '+12025550103']]) {
      const fresh = await seed(engine, `fence-${kind}`, phone);
      const action = await store.queueSmsReplyOnce({ ...reply, messageSid: `SM${randomUUID().replaceAll('-', '')}`,
        recipient: phone, contactKey: fresh.opportunity.contactKey, opportunityId: fresh.opportunity.id }, tenant);
      assert.equal(action.queued, true);
      const [claim, ...extra] = await store.claimDueActions({ workerId: `rehearsal-${runId}`, limit: 2 });
      assert.equal(extra.length, 0); assert.equal(claim.id, action.actionId);
      if (kind === 'recipient') await store.upsertContact(fresh.opportunity.contactKey, { phone: '+12025550199' });
      else {
        // A recipient tombstone appearing after claim must fence even an alias
        // whose own contact flags have not yet been updated.
        const contactKey = `${tenant.tenantId}:suppressed-recipient:phone:${encodeURIComponent(phone)}`;
        await store.upsertContact(contactKey, { contactKey, kind: 'recipient_suppression',
          recipient: { kind: 'phone', value: phone }, suppressed: true, optedOut: true });
      }
      const blocked = await store.beginDispatch(claim.id, claim, new Date(), tenant);
      assert.equal(blocked.status, 'blocked');
      assert.equal(blocked.blockedReason, kind === 'recipient' ? 'sms_recipient_changed' : 'contact_suppressed');
      assert.equal(blocked.claimedBy, null); assert.equal(blocked.claimExpiresAt, null);
    }
    result = { event: 'private_lab.sms_database_rehearsal', ok: true,
      coverage: { callerQueueDuplicates: true, replyQueueDuplicates: true, atomicRollbackAndRetry: true,
        restartReplay: true, stopCancellation: true, recipientSuppression: true, stopReplay: true,
        futureImportSuppression: true, tenantIsolation: true, beginDispatchRecipientFence: true, beginDispatchSuppressionFence: true },
      providerCalls: 0, providerAcceptanceVerified: false, deliveryVerified: false,
      schemaChanges: 0, realTenantConfigurationChanges: 0,
      databaseSequenceMayAdvance: true, ...fixture.stats() };
  } catch (error) { failure = error; }
  finally {
    if (initialized) {
      try { result = { ...result, ...await cleanupFixtures(pool, fixture.allowlist) }; }
      catch {
        // Preserve only generated recovery identifiers for manual cleanup; never
        // SQL, URLs, provider errors, credentials, phone numbers or message text.
        const error = new Error('sms_rehearsal_cleanup_failed');
        error.fixtureTenantIds = tenantIds;
        error.cleanupVerified = false;
        throw error;
      }
    }
  }
  if (failure) {
    const error = new Error('sms_rehearsal_checks_failed');
    error.cleanupVerified = initialized; error.cause = failure; throw error;
  }
  return result;
}
