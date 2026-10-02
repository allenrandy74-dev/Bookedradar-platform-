import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { LAB_NAME, LAB_DATABASE } from '../scripts/private-voice-lab-start.mjs';
import { smsRehearsalPoolConfig, validateSmsRehearsalEnvironment, safeFailureReport } from '../scripts/private-lab-sms-rehearsal.mjs';
import { runSmsPersistenceRehearsal, syntheticSmsTenant, verifyDisabledSmsEntryPoints, createFixturePool, cleanupFixtures, TABLE_KEYS, LIMITS } from '../scripts/lib/private-lab-sms-rehearsal-core.mjs';

import { RecoveryStore } from '../src/recovery/store.js';
import { RecoveryEngine } from '../src/recovery/engine.js';

const args = ['--expected-host=dpg-private-lab'];
const env = { PRIVATE_VOICE_LAB: 'true', RENDER_SERVICE_NAME: LAB_NAME,
  DATABASE_URL: `postgresql://u:never-print-me@dpg-private-lab/${LAB_DATABASE}`,
  PRIVATE_VOICE_LAB_DATABASE_HOST: 'dpg-private-lab', OPENAI_PROJECT_ID: 'proj_O0Mk7nAzTfe0AIys8Ukwd1cn',
  VOICE_ENABLED: 'false', DISPATCH_ENABLED: 'false', BOOKEDRADAR_BILLING_ENABLED: 'false', OPS_ALERTS_ENABLED: 'false' };
const fixtureIds = () => ['a', 'b'].map(suffix => `synthetic-sms-rehearsal-${randomUUID()}-${suffix}`);

test('SMS rehearsal requires exact service/database/explicit host and strict OFF flags', () => {
  assert.deepEqual(validateSmsRehearsalEnvironment(env, args), { expectedHost: 'dpg-private-lab' });
  for (const bad of [[], [...args, '--skip-guards'], ['--expected-host=localhost'], ['--expected-host=dpg-other'], [...args, ...args]]) {
    assert.throws(() => validateSmsRehearsalEnvironment(env, bad));
  }
  for (const patch of [{ RENDER_SERVICE_NAME: 'bookedradar-platform' }, { PRIVATE_VOICE_LAB: 'false' },
    { DATABASE_URL: 'postgresql://u:secret@dpg-production/production' },
    { PRIVATE_VOICE_LAB_DATABASE_HOST: 'dpg-other' }, { OPENAI_PROJECT_ID: 'different-project' }]) {
    assert.throws(() => validateSmsRehearsalEnvironment({ ...env, ...patch }, args));
  }
  for (const key of ['VOICE_ENABLED', 'DISPATCH_ENABLED', 'BOOKEDRADAR_BILLING_ENABLED', 'OPS_ALERTS_ENABLED']) {
    for (const value of [undefined, '', 'true', 'False', 'FALSE', ' false ', '0']) {
      assert.throws(() => validateSmsRehearsalEnvironment({ ...env, [key]: value }, args), key);
    }
  }
});

test('SMS rehearsal refuses URL overrides and existing forbidden integration credentials', () => {
  for (const suffix of ['?host=dpg-other', '?dbname=production', '?sslmode=disable', '#fragment']) {
    assert.throws(() => validateSmsRehearsalEnvironment({ ...env, DATABASE_URL: env.DATABASE_URL + suffix }, args));
  }
  for (const key of ['TWILIO_AUTH_TOKEN', 'DEMO_HVAC_WIX_API_KEY', 'RESEND_API_KEY', 'STRIPE_SECRET_KEY', 'HUMAN_TRANSFER_NUMBER']) {
    assert.throws(() => validateSmsRehearsalEnvironment({ ...env, [key]: 'never-print-me' }, args));
  }
  for (const key of ['POSTGRES_SHADOW_IMPORT_ON_STARTUP', 'POSTGRES_RESTORE_DRILL_ON_STARTUP', 'POSTGRES_JSON_ROLLBACK_ON_STARTUP']) {
    assert.throws(() => validateSmsRehearsalEnvironment({ ...env, [key]: ' TRUE ' }, args));
  }
});

test('both public queue gates stop before reads or generation; environment is unchanged', async () => {
  const before = structuredClone(env);
  assert.equal(await verifyDisabledSmsEntryPoints(env), true);
  assert.deepEqual(env, before);
});

test('CLI failure output is bounded and never echoes credentials or raw errors', () => {
  for (const error of [new Error('postgresql://u:never-print-me@some-host/db'), new Error('sk-never-print-me'),
    Object.assign(new Error('sms_rehearsal_cleanup_failed'), { fixtureTenantIds: ['never-print-me', ...fixtureIds()] })]) {
    const text = JSON.stringify(safeFailureReport(error));
    assert.ok(!text.includes('never-print-me')); assert.ok(text.length < 900);
    assert.equal(JSON.parse(text).ok, false);
  }
  const child = spawnSync(process.execPath, ['scripts/private-lab-sms-rehearsal.mjs', '--unexpected=never-print-me'],
    { cwd: new URL('..', import.meta.url), env: { ...process.env, DATABASE_URL: env.DATABASE_URL }, encoding: 'utf8', timeout: 5000 });
  assert.equal(child.status, 1); assert.equal(child.stdout, '');
  const output = JSON.parse(child.stderr); assert.equal(output.error, 'sms_rehearsal_arguments_invalid');
  assert.ok(!child.stderr.includes('never-print-me')); assert.ok(!child.stderr.includes('Error:'));
});

test('fixture wrapper records generated IDs before failed INSERT and cleanup restricts exact namespace and IDs', async () => {
  const ids = fixtureIds(), queries = [];
  const pool = { async connect() { return { async query(sql, values) {
    queries.push({ sql, values });
    if (sql.startsWith('INSERT')) throw new Error('synthetic_transport_failure');
    return { rows: [{ n: 0 }], rowCount: 1 };
  }, release() {} }; } };
  const fixture = createFixturePool(pool, ids), client = await fixture.pool.connect();
  const sql = 'INSERT INTO bookedradar.recovery_actions AS existing (action_id,tenant_id,payload) VALUES ($1,$2,$3)';
  await assert.rejects(client.query(sql, ['act-generated', ids[0], '{}']), /synthetic_transport_failure/);
  assert.equal(fixture.allowlist.get(ids[0]).get('recovery_actions').has('act-generated'), true);
  assert.throws(() => client.query(sql, ['act-foreign', 'real-tenant', '{}']), /foreign_tenant/);
  assert.throws(() => client.query('DROP SCHEMA bookedradar CASCADE'), /unexpected_query/);
  assert.throws(() => client.query('DELETE FROM bookedradar.recovery_actions WHERE tenant_id=$1', [ids[0]]), /unexpected_query/);
  client.release();
  assert.equal((await cleanupFixtures(pool, fixture.allowlist)).syntheticRowsRemaining, 0);
  const deletes = queries.filter(x => x.sql.startsWith('DELETE'));
  assert.equal(deletes.length, 1);
  assert.match(deletes[0].sql, /WHERE tenant_id=\$1 AND action_id=ANY\(\$2::text\[\]\)/);
  assert.deepEqual(deletes[0].values, [ids[0], ['act-generated']]);
});

test('fixture wrapper has a hard attempted-row cap and accepts no existing tenant namespace', async () => {
  const pool = { async connect() { return { async query() { return { rows: [] }; }, release() {} }; } };
  assert.throws(() => createFixturePool(pool, ['real-tenant', 'other-real']));
  const ids = fixtureIds(), fixture = createFixturePool(pool, ids), client = await fixture.pool.connect();
  for (let i = 0; i < LIMITS.rows; i++) await client.query(
    'INSERT INTO bookedradar.recovery_actions AS existing (action_id,tenant_id,payload) VALUES ($1,$2,$3)', [`act-${i}`, ids[0], '{}']);
  assert.throws(() => client.query('INSERT INTO bookedradar.recovery_actions AS existing (action_id,tenant_id,payload) VALUES ($1,$2,$3)', ['act-over-limit', ids[0], '{}']), /fixture_row_limit/);
  assert.equal(Object.keys(TABLE_KEYS).length, 6); client.release();
});


test('inert fixture policy creates a real opportunity and attribution, with zero seeded actions', async () => {
  const tenant = syntheticSmsTenant(fixtureIds()[0]);
  const store = new RecoveryStore('/unused/sms-rehearsal-test.json');
  store.loaded = true; store.persist = async () => {};
  const result = await new RecoveryEngine({ store, tenant }).ingest({
    idempotencyKey: 'fixture-seed-unit', tenantId: tenant.tenantId, type: 'phone_lead',
    contact: { externalId: 'unit-seed', phone: '+12025550101', transactionalSmsAllowed: true },
    metadata: { callId: 'unit-call' },
  });
  assert.ok(result.opportunity.id); assert.equal(result.opportunity.tenantId, tenant.tenantId);
  assert.equal(result.opportunity.metadata.callId, 'unit-call');
  assert.deepEqual(result.actions, []);
  assert.equal(Object.keys((await store.snapshot()).actions).length, 0);
  assert.equal(Object.keys((await store.snapshot()).attribution).length, 1);
});


test('unconnected pg config pins exact lab host/database/5432 despite ambient PG defaults', () => {
  const before = process.env.PGPORT;
  try {
    process.env.PGPORT = '6543';
    const client = new Client(smsRehearsalPoolConfig(env, args));
    assert.equal(client.connectionParameters.port, 5432);
    assert.equal(client.connectionParameters.host, 'dpg-private-lab');
    assert.equal(client.connectionParameters.database, LAB_DATABASE);
  } finally {
    if (before === undefined) delete process.env.PGPORT; else process.env.PGPORT = before;
  }
});

test('bounded fixture start marker precedes any store transaction or write', async () => {
  let marker;
  const pool = { async query(sql) {
    assert.match(sql, /^SELECT count/); return { rows: [{ n: 0 }] };
  }, async connect() {
    assert.ok(marker, 'no store/cleanup connection before marker');
    throw new Error('synthetic_no_database');
  } };
  await assert.rejects(runSmsPersistenceRehearsal(pool, { onStart: value => { marker = value; } }), /sms_rehearsal_cleanup_failed/);
  assert.equal(marker.event, 'private_lab.sms_database_rehearsal_started');
  assert.equal(marker.fixtureTenantIds.length, 2);
  assert.equal(marker.interruptionCleanupGuaranteed, false);
  assert.ok(JSON.stringify(marker).length < 600);
  assert.ok(!JSON.stringify(marker).includes('postgres'));
});
