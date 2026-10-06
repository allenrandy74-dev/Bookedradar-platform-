import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { applyPostgresSchema } from '../src/postgres-runtime.js';
import { verifyPostgresReleaseSchema } from '../src/postgres-schema-inspection.js';
import { readPostgresSnapshot, exportPostgresPlatform } from '../src/postgres-full-export.js';
import { syncPostgresSnapshotToJson } from '../src/postgres-json-rollback.js';
import { runPostgresTransactionalRestoreDrill } from '../src/postgres-restore-drill.js';

const connectionString = process.env.POSTGRES_TEST_URL;
async function fixture(t) {
  const url = new URL(connectionString);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.equal(url.pathname, '/bookedradar_test');
  const pool = new Pool({ connectionString });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'br-production-upgrade-'));
  t.after(async () => {
    await pool.query('DROP SCHEMA IF EXISTS bookedradar CASCADE');
    await pool.end();
    await fs.rm(root, { recursive: true, force: true });
  });
  await pool.query('DROP SCHEMA IF EXISTS bookedradar CASCADE');
  const schema = await fs.readFile(new URL('../db/postgres-schema.sql', import.meta.url), 'utf8');
  return { pool, root, schema };
}

test('production baseline upgrade is atomic and preserves synthetic historical rows and tenant replay keys', { skip: !connectionString }, async t => {
  const { pool, schema } = await fixture(t);
  // Exact SQL from production main ddcfd415, the PR94 lineage; no live data.
  const oldSchema = await fs.readFile(new URL('./fixtures/production-schema-ddcfd415.sql', import.meta.url), 'utf8');
  await applyPostgresSchema(pool, oldSchema);
  await pool.query("INSERT INTO bookedradar.call_control_state VALUES ('synthetic-old-call','synthetic-a',now(),'{\"tenantId\":\"synthetic-a\",\"marker\":\"preserve\"}')");
  await pool.query("INSERT INTO bookedradar.recovery_events(event_id,tenant_id,idempotency_key,occurred_at,payload) VALUES ('old-event','synthetic-a','shared-key',now(),'{\"marker\":\"preserve\"}')");
  const before = (await pool.query('SELECT * FROM bookedradar.recovery_events')).rows;
  await assert.rejects(verifyPostgresReleaseSchema(pool), /migration_required/);
  await assert.rejects(applyPostgresSchema(pool, schema + '\nSELECT production_upgrade_deliberate_failure();'));
  assert.equal((await pool.query("SELECT to_regclass('bookedradar.provider_attempt_receipts') AS t")).rows[0].t, null);
  assert.deepEqual((await pool.query('SELECT * FROM bookedradar.recovery_events')).rows, before);
  await assert.rejects(pool.query("INSERT INTO bookedradar.recovery_events(event_id,tenant_id,idempotency_key,occurred_at,payload) VALUES ('blocked-old','synthetic-b','shared-key',now(),'{}')"), { code: '23505' });
  await applyPostgresSchema(pool, schema);
  assert.equal((await verifyPostgresReleaseSchema(pool)).ok, true);
  assert.deepEqual((await pool.query("SELECT * FROM bookedradar.recovery_events WHERE event_id='old-event'")).rows, before);
  assert.equal((await pool.query("SELECT payload->>'marker' AS marker FROM bookedradar.call_control_state WHERE call_id='synthetic-old-call'")).rows[0].marker, 'preserve');
  await pool.query("INSERT INTO bookedradar.recovery_events(event_id,tenant_id,idempotency_key,occurred_at,payload) VALUES ('new-event','synthetic-b','shared-key',now(),'{}')");
  await assert.rejects(pool.query("INSERT INTO bookedradar.recovery_events(event_id,tenant_id,idempotency_key,occurred_at,payload) VALUES ('duplicate','synthetic-a','shared-key',now(),'{}')"), { code: '23505' });
  // A code-only/global-unique rollback cannot represent the now-valid state.
  await assert.rejects(pool.query('ALTER TABLE bookedradar.recovery_events ADD CONSTRAINT unsafe_global_rollback UNIQUE(idempotency_key)'), { code: '23505' });
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM bookedradar.recovery_events')).rows[0].n, 2);
  assert.equal((await verifyPostgresReleaseSchema(pool)).ok, true);
});

test('nonempty production incidents block lossy JSON export, rollback and logical drill without changes', { skip: !connectionString }, async t => {
  const { pool, root, schema } = await fixture(t);
  await applyPostgresSchema(pool, schema);
  // Empty production incident table retains the supported projection path.
  assert.ok((await readPostgresSnapshot(pool)).state);
  assert.ok((await exportPostgresPlatform(pool, path.join(root, 'empty-export'), { writersQuiesced: true })).directory);
  await pool.query("INSERT INTO bookedradar.ops_incidents(incident_key,scope_key,severity,status,payload) VALUES ('synthetic-incident','synthetic-scope','warning','resolved','{\"marker\":\"preserve\"}')");
  const before = (await pool.query('SELECT * FROM bookedradar.ops_incidents')).rows;
  const error = /postgres_platform_export_requires_all_table_backup_for_ops_state/;
  await assert.rejects(exportPostgresPlatform(pool, path.join(root, 'blocked-export'), { writersQuiesced: true }), error);
  await assert.rejects(fs.access(path.join(root, 'blocked-export')));
  const target = path.join(root, 'state.json');
  await fs.writeFile(target, '{"sentinel":"unchanged"}');
  await assert.rejects(syncPostgresSnapshotToJson({
    env: { BOOKEDRADAR_STORAGE_BACKEND: 'json', POSTGRES_JSON_ROLLBACK_ARMED: 'true',
      DATABASE_URL: 'postgresql://synthetic@managed.invalid/synthetic', STATE_FILE: target },
    // Only this injected factory can connect; the placeholder is never dialed.
    createPool: () => new Pool({ connectionString }),
  }), error);
  assert.equal(await fs.readFile(target, 'utf8'), '{"sentinel":"unchanged"}');
  assert.deepEqual((await fs.readdir(root)).sort(), ['empty-export', 'state.json']);
  const namespaceBefore = (await pool.query("SELECT oid FROM pg_namespace WHERE nspname='bookedradar'")).rows;
  await assert.rejects(runPostgresTransactionalRestoreDrill(pool, schema), error);
  assert.deepEqual((await pool.query("SELECT oid FROM pg_namespace WHERE nspname='bookedradar'")).rows, namespaceBefore);
  assert.deepEqual((await pool.query('SELECT * FROM bookedradar.ops_incidents')).rows, before);
  assert.equal((await pool.query("SELECT to_regclass('bookedradar.ops_notifications') AS t")).rows[0].t, null);
});
