import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RecoveryStore } from '../src/recovery/store.js';
import { RecoveryEngine } from '../src/recovery/engine.js';

const scoped = (tenant, key) => JSON.stringify([tenant, key]);
const marker = 'tenant_scoped_v1';
async function fixture(t, overrides = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'br-aliases-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'state.json');
  const data = { opportunities: { opp: { id: 'opp', tenantId: 'tenant-a', sourceEventId: 'event-a' } },
    contacts: {}, actions: {}, attribution: {},
    events: [{ id: 'event-a', tenantId: 'tenant-a', type: 'phone_lead', idempotencyKey: 'primary', occurredAt: new Date().toISOString() }],
    eventKeys: { 'manual-alias': 'event-a' }, ...overrides };
  await fs.writeFile(file, JSON.stringify(data));
  return { file, data, store: new RecoveryStore(file) };
}

test('legacy manual alias survives load, duplicate engine ingestion, persistence and restart without index expansion', async t => {
  const { file, store } = await fixture(t);
  const before = await store.snapshot();
  assert.equal(before.eventKeyFormat, marker);
  assert.deepEqual(before.eventKeys, { [scoped('tenant-a', 'manual-alias')]: 'event-a' });
  assert.equal(await store.hasEventKey('manual-alias', 'tenant-a'), true);
  assert.equal(await store.hasEventKey('primary', 'tenant-a'), true);
  assert.equal(await store.hasEventKey('manual-alias', 'tenant-b'), false);
  const result = await new RecoveryEngine({ store, tenant: { tenantId: 'tenant-a', industry: 'hvac' } })
    .ingest({ tenantId: 'tenant-a', type: 'phone_lead', idempotencyKey: 'manual-alias', contact: { phone: '+12025550100' } });
  assert.equal(result.duplicate, true);
  const after = await store.snapshot();
  assert.equal(after.events.length, 1);
  assert.equal(Object.keys(after.opportunities).length, 1);
  assert.equal(Object.keys(after.eventKeys).length, 1);
  await store.upsertContact('tenant-a:fixture', { tenantId: 'tenant-a' });
  const disk = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(disk.eventKeyFormat, marker);
  assert.equal(Object.keys(disk.eventKeys).length, 1);
  assert.equal((await new RecoveryStore(file).addEvent({ tenantId: 'tenant-a', idempotencyKey: 'manual-alias' })).duplicate, true);
});

test('all explicit aliases survive normalization and retention pruning for retained events', async t => {
  const { store } = await fixture(t, { eventKeys: { primary: 'event-a', 'manual-a': 'event-a', 'manual-b': 'event-a' } });
  await store.prune();
  const snapshot = await store.snapshot();
  assert.equal(Object.keys(snapshot.eventKeys).length, 3);
  for (const key of ['primary', 'manual-a', 'manual-b']) assert.equal(await store.hasEventKey(key, 'tenant-a'), true);
  await store.prune({ now: new Date(Date.now() + 100 * 86400000) });
  assert.deepEqual((await store.snapshot()).eventKeys, {});
});

for (const field of ['idempotencyKey', 'id']) {
  test(`unmarked JSON-literal payload ${field} remains a raw key`, async t => {
    const literal = '["tenant-a","literal-key"]';
    const event = { id: 'event-a', tenantId: 'tenant-a', [field]: literal };
    const { store } = await fixture(t, { opportunities: {}, events: [event], eventKeys: { [literal]: event.id } });
    const snapshot = await store.snapshot();
    assert.deepEqual(snapshot.eventKeys, { [scoped('tenant-a', literal)]: event.id });
    assert.equal((await store.addEvent({ tenantId: 'tenant-a', idempotencyKey: literal })).duplicate, true);
    assert.equal(await store.hasEventKey('literal-key', 'tenant-a'), false);
  });
}

test('marked maps safely decode aliases including nested JSON-literal raw aliases', async t => {
  const alias = '["somebody","literal"]';
  const { store } = await fixture(t, { eventKeyFormat: marker, eventKeys: { [scoped('tenant-a', alias)]: 'event-a' } });
  assert.equal(await store.hasEventKey(alias, 'tenant-a'), true);
  assert.equal((await store.addEvent({ tenantId: 'tenant-a', idempotencyKey: alias })).duplicate, true);
  assert.equal(Object.keys((await store.snapshot()).eventKeys).length, 1);
});

test('unmarked tuple-looking aliases are ambiguous and fail closed without changing bytes', async t => {
  const { file, store } = await fixture(t, { eventKeys: { [scoped('tenant-a', 'manual-alias')]: 'event-a' } });
  const bytes = await fs.readFile(file, 'utf8');
  await assert.rejects(store.addEvent({ tenantId: 'tenant-a', idempotencyKey: 'manual-alias' }), /event_key_format_ambiguous/);
  assert.equal(await fs.readFile(file, 'utf8'), bytes);
});

test('marked foreign owner, dangling receipt and conflicting alias/canonical mappings fail closed', async t => {
  const cases = [
    { eventKeyFormat: marker, eventKeys: { [scoped('tenant-b', 'manual-alias')]: 'event-a' }, error: /event_key_owner_conflict/ },
    { eventKeys: { alias: 'missing' }, error: /event_key_unknown_event/ },
    { eventKeys: { 'manual-alias': 'event-a' }, events: [{ id: 'event-a', tenantId: 'tenant-a', idempotencyKey: 'primary' }, { id: 'event-b', tenantId: 'tenant-a', idempotencyKey: 'manual-alias' }], error: /event_key_conflict/ },
  ];
  for (const { error, ...data } of cases) {
    const { store } = await fixture(t, data);
    await assert.rejects(store.snapshot(), error);
  }
});

test('new events persist a format marker and distinct tenants retain the same raw key', async t => {
  const { file, store } = await fixture(t, { events: [], eventKeys: {}, opportunities: {} });
  await store.addEvent({ tenantId: 'tenant-a', idempotencyKey: 'shared' });
  await store.addEvent({ tenantId: 'tenant-b', idempotencyKey: 'shared' });
  const data = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(data.eventKeyFormat, marker);
  assert.equal(Object.keys(data.eventKeys).length, 2);
  for (const tenantId of ['tenant-a', 'tenant-b']) assert.equal((await new RecoveryStore(file).addEvent({ tenantId, idempotencyKey: 'shared' })).duplicate, true);
});
