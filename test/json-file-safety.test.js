import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStateStore } from '../src/state-store.js';
import { CallHistoryStore } from '../src/call-history.js';
import { ActionDispatcher } from '../src/integrations/dispatcher.js';
import { RecoveryEngine } from '../src/recovery/engine.js';
import { RecoveryStore } from '../src/recovery/store.js';

async function file(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'br-json-safe-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return path.join(dir, 'store.json');
}

test('independent stale state instances merge records and atomically claim a webhook', async t => {
  const p = await file(t); const a = new JsonStateStore(p), b = new JsonStateStore(p);
  await Promise.all([a.load(), b.load()]);
  await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b).patchCall(`c${i}`, { tenantId: 't' })));
  assert.equal(Object.keys(JSON.parse(await fs.readFile(p)).calls).length, 20);
  const claims = await Promise.all([a.markWebhookOnce('same'), b.markWebhookOnce('same')]);
  assert.deepEqual(claims.sort(), [false, true]);
  await assert.rejects(b.patchCall('c0', { tenantId: 'other' }), /immutable_tenantId/);
  const external = await a.getCall('c0'); external.tenantId = 'tampered';
  assert.equal((await b.getCall('c0')).tenantId, 't');
});

test('history retains concurrent transcript turns and freezes tenant ownership', async t => {
  const p = await file(t); const a = new CallHistoryStore(p), b = new CallHistoryStore(p);
  await a.start('c', { tenantId: 't' }); await b.load();
  await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b).addTurn('c', { text: `turn ${i}` })));
  assert.equal((await a.get('t', 'c')).transcript.length, 20);
  await assert.rejects(b.start('c', { tenantId: 'other' }), /immutable_tenantId/);
  await assert.rejects(b.finish('c', { tenantId: 'other' }), /immutable_tenantId/);
});

test('recovery receipt and dependent opportunity rollback together; tenant event keys are independent', async t => {
  const p = await file(t); const a = new RecoveryStore(p), b = new RecoveryStore(p);
  await assert.rejects(a.transaction(async tx => {
    await tx.addEvent({ tenantId: 'a', idempotencyKey: 'same', type: 'missed_call' });
    await tx.createOpportunity({ id: 'orphan', tenantId: 'a' });
    throw new Error('synthetic crash before commit');
  }), /synthetic crash/);
  assert.equal((await b.snapshot()).events.length, 0);
  assert.equal(await b.getOpportunity('orphan'), null);
  const events = await Promise.all([a.addEvent({ tenantId: 'a', idempotencyKey: 'same' }), b.addEvent({ tenantId: 'b', idempotencyKey: 'same' })]);
  assert.equal(events.filter(e => e.duplicate).length, 0);
  assert.equal((await a.addEvent({ tenantId: 'a', idempotencyKey: 'same' })).duplicate, true);
  await a.createOpportunity({ id: 'opp', tenantId: 'a' });
  await assert.rejects(b.patchOpportunity('opp', { tenantId: 'b' }), /immutable_tenantId/);
});

test('durable attempts are cross-instance exclusive, fenced, and never TTL-pruned', async t => {
  const p = await file(t); const a = new JsonStateStore(p), b = new JsonStateStore(p);
  const intent = { tenantId: 'a', callId: 'c', target: 'synthetic', kind: 'transfer', fingerprint: 'f' };
  const claims = await Promise.all([a.claimAttempt('attempt', intent), b.claimAttempt('attempt', intent)]);
  assert.equal(claims.filter(x => x.claimed).length, 1);
  await assert.rejects(a.finishAttempt('attempt', { ...intent, status: 'accepted', claimToken: 'wrong' }), /attempt_claim_conflict/);
  await b.finishAttempt('attempt', { ...intent, status: 'accepted', claimToken: claims[0].record.claimToken });
  await assert.rejects(a.finishAttempt('attempt', { ...intent, status: 'failed', claimToken: claims[0].record.claimToken }), /attempt_claim_conflict/);
  await a.prune(Date.now() + 365 * 86400000);
  assert.equal((await new JsonStateStore(p).claimAttempt('attempt', intent)).claimed, false);
});

test('stale explicit snapshot persistence rejects rather than deleting a newer writer', async t => {
  const p = await file(t); const a = new RecoveryStore(p), b = new RecoveryStore(p);
  await a.load(); await b.createOpportunity({ id: 'kept', tenantId: 'a' });
  await assert.rejects(a.persist(), /json_store_stale_snapshot/);
  assert.ok(await b.getOpportunity('kept'));
});


test('engine failure between receipt and opportunity leaves a retryable event, then one complete recovery', async t => {
  const p = await file(t); const store = new RecoveryStore(p);
  const tenant = { tenantId: 'synthetic', industry: 'hvac' };
  const event = { type: 'phone_lead', tenantId: 'synthetic', idempotencyKey: 'retry-event', contact: { phone: '+12025550100' } };
  store.createOpportunity = async () => { throw new Error('synthetic interruption'); };
  await assert.rejects(new RecoveryEngine({ store, tenant }).ingest(event), /synthetic interruption/);
  const restarted = new RecoveryStore(p);
  assert.equal((await restarted.snapshot()).events.length, 0);
  const result = await new RecoveryEngine({ store: restarted, tenant }).ingest(event);
  assert.notEqual(result.duplicate, true);
  const snapshot = await restarted.snapshot();
  assert.equal(snapshot.events.length, 1);
  assert.equal(Object.keys(snapshot.opportunities).length, 1);
  assert.equal((await new RecoveryEngine({ store: restarted, tenant }).ingest(event)).duplicate, true);
});

test('record dictionary IDs cannot inherit object prototype data', async t => {
  const p = await file(t); const store = new JsonStateStore(p);
  assert.equal(await store.getCall('constructor'), null);
  await store.patchCall('__proto__', { tenantId: 'synthetic' });
  assert.equal((await new JsonStateStore(p).getCall('__proto__')).tenantId, 'synthetic');
  assert.equal(await store.getCall('constructor'), null);
});


test('directory aliases share a lock and symlink data files fail closed', async t => {
  const p = await file(t); const dir = path.dirname(p);
  await fs.mkdir(path.join(dir, 'actual'));
  await fs.symlink(path.join(dir, 'actual'), path.join(dir, 'alias'));
  const a = new JsonStateStore(path.join(dir, 'actual', 'data.json'));
  const b = new JsonStateStore(path.join(dir, 'alias', 'data.json'));
  const claims = await Promise.all([a.markWebhookOnce('alias-key'), b.markWebhookOnce('alias-key')]);
  assert.deepEqual(claims.sort(), [false, true]);
  await fs.symlink(a.filePath, p);
  await assert.rejects(new JsonStateStore(p).patchCall('unsafe', { tenantId: 'a' }), /unsupported_file_type/);
  assert.equal(await a.getCall('unsafe'), null);
});

test('durable attempt replay tolerates database JSON object key order', async t => {
  const p = await file(t); const store = new JsonStateStore(p);
  const intent = { tenantId: 'a', callId: 'c', target: 'synthetic', kind: 'transfer', fingerprint: 'f' };
  await store.claimAttempt('attempt', intent);
  const data = JSON.parse(await fs.readFile(p, 'utf8'));
  data.attempts.attempt.identity = Object.fromEntries(Object.entries(data.attempts.attempt.identity).reverse());
  await fs.writeFile(p, JSON.stringify(data));
  assert.equal((await new JsonStateStore(p).claimAttempt('attempt', intent)).claimed, false);
});


test('legacy ownerless source receipt resolves through sourceEventId and replays without a new opportunity', async t => {
  const p = await file(t);
  const data = { events: [{ id: 'legacy-event', idempotencyKey: 'legacy-key', type: 'phone_lead' }],
    eventKeys: { 'legacy-key': 'legacy-event' }, contacts: {}, actions: {}, attribution: {},
    opportunities: { legacy: { id: 'legacy', tenantId: 'synthetic', sourceEventId: 'legacy-event', status: 'open' } } };
  await fs.writeFile(p, JSON.stringify(data));
  const store = new RecoveryStore(p);
  const result = await new RecoveryEngine({ store, tenant: { tenantId: 'synthetic', industry: 'hvac' } })
    .ingest({ tenantId: 'synthetic', idempotencyKey: 'legacy-key', type: 'phone_lead', contact: { phone: '+12025550100' } });
  assert.equal(result.duplicate, true);
  assert.equal(Object.keys((await store.snapshot()).opportunities).length, 1);
  data.opportunities.foreign = { id: 'foreign', tenantId: 'other', sourceEventId: 'legacy-event' };
  await fs.writeFile(p, JSON.stringify(data));
  await assert.rejects(new RecoveryStore(p).snapshot(), /event_owner_ambiguous/);
});


test('final dispatch reload rejects changed caller attestation and uncertain actions cannot be reset', async t => {
  const p = await file(t); const store = new RecoveryStore(p), other = new RecoveryStore(p);
  const tenant = { tenantId: 'synthetic' }, contactKey = 'synthetic:contact';
  await store.upsertContact(contactKey, { tenantId: 'synthetic', phone: '+12025550100', transactionalSmsAllowed: true });
  await store.createOpportunity({ id: 'opp', tenantId: 'synthetic', contactKey });
  await store.scheduleAction({ id: 'sms', tenantId: 'synthetic', contactKey, opportunityId: 'opp',
    channel: 'sms', purpose: 'transactional', template: 'caller_text', content: 'Synthetic message',
    expectedRecipient: '+12025550100', confirmedCallbackNumber: '+12025550100', callerRequested: true,
    dueAt: new Date(0).toISOString() });
  let sends = 0;
  const dispatcher = new ActionDispatcher({ store, tenant, adapters: { sms: { send: async () => { sends++; return { sid: 'synthetic' }; } } },
    resolveContact: async ({ contact }) => { await other.patchAction('sms', { callerRequested: false }); return contact; } });
  const result = await dispatcher.runOnce();
  assert.equal(sends, 0);
  assert.equal(result[0].action.status, 'blocked');
  assert.equal(result[0].action.blockedReason, 'sms_confirmation_binding_required');
  await assert.rejects(store.patchAction('sms', { status: 'pending' }), /action_reenable_forbidden/);
  await store.scheduleAction({ id: 'uncertain', tenantId: 'synthetic', status: 'reconciliation_required' });
  await assert.rejects(other.patchAction('uncertain', { status: 'processing' }), /action_reenable_forbidden/);
});
