import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Pool } from 'pg';
import { applyPostgresSchema } from '../src/postgres-runtime.js';
import { verifyPostgresReleaseSchema } from '../src/postgres-schema-inspection.js';
import { createPostgresServerStores } from '../src/postgres-server-stores.js';

const connectionString = process.env.POSTGRES_TEST_URL;
test('real Postgres: release startup rejects legacy/incompatible schemas without mutating them', {skip:!connectionString}, async () => {
  const url = new URL(connectionString);
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
  assert.equal(url.pathname, '/bookedradar_test');
  const pool = new Pool({connectionString});
  const schema = await fs.readFile(new URL('../db/postgres-schema.sql', import.meta.url), 'utf8');
  const reset = async () => { await pool.query('DROP SCHEMA IF EXISTS bookedradar CASCADE'); await applyPostgresSchema(pool,schema); };
  const reject = async pattern => assert.rejects(createPostgresServerStores({connectionString,mode:'lab'}),pattern);
  try {
    await reset();
    assert.equal((await verifyPostgresReleaseSchema(pool)).ok,true);
    const stores=await createPostgresServerStores({connectionString,mode:'lab'});
    assert.equal(stores.schemaValidation.ok,true); await stores.close();
    await pool.query('DROP TABLE bookedradar.provider_attempt_receipts');
    await reject(/missing_table:provider_attempt_receipts/);
    assert.equal((await pool.query("SELECT to_regclass('bookedradar.provider_attempt_receipts') AS t")).rows[0].t,null);
    await reset();
    // Prior release shape, with its global uniqueness still present.
    await pool.query('ALTER TABLE bookedradar.recovery_events ADD CONSTRAINT legacy_global UNIQUE (idempotency_key)');
    await reject(/legacy_global_unique_key/);
    await pool.query('ALTER TABLE bookedradar.recovery_events DROP CONSTRAINT legacy_global');
    await pool.query('CREATE UNIQUE INDEX renamed_global ON bookedradar.recovery_events (idempotency_key)');
    await reject(/legacy_global_unique_key/);
    await pool.query('DROP INDEX bookedradar.renamed_global');
    await pool.query('ALTER TABLE bookedradar.recovery_events DROP CONSTRAINT recovery_events_tenant_id_idempotency_key_key');
    await pool.query('DROP INDEX bookedradar.recovery_events_tenant_idempotency_idx');
    await pool.query('CREATE UNIQUE INDEX recovery_events_tenant_idempotency_idx ON bookedradar.recovery_events (tenant_id,idempotency_key) WHERE tenant_id IS NOT NULL');
    await reject(/tenant_unique_key_required/);
    await pool.query('DROP INDEX bookedradar.recovery_events_tenant_idempotency_idx');
    await pool.query('CREATE UNIQUE INDEX recovery_events_tenant_idempotency_idx ON bookedradar.recovery_events (event_id)');
    await reject(/tenant_unique_key_required/);
    await reset();
    await pool.query('ALTER TABLE bookedradar.provider_attempt_receipts ADD CONSTRAINT deferred_attempt UNIQUE (attempt_key) DEFERRABLE');
    await reject(/deferrable_key_unsupported/);
    await reset();
    await pool.query('ALTER TABLE bookedradar.provider_attempt_receipts DROP CONSTRAINT provider_attempt_receipts_pkey');
    await reject(/provider_attempt_receipts_unique_key_required/);
    await reset();
    await pool.query('ALTER TABLE bookedradar.provider_attempt_receipts ALTER COLUMN payload DROP NOT NULL');
    await reject(/incompatible_column:provider_attempt_receipts.payload/);
    await reset();
    await pool.query('ALTER TABLE bookedradar.provider_attempt_receipts DROP CONSTRAINT provider_attempt_receipts_payload_check');
    await reject(/object_check_required/);
    await reset();
    // Rehearse known legacy upgrade only on this freshly initialized synthetic fixture.
    await pool.query('DROP TABLE bookedradar.provider_attempt_receipts');
    await pool.query('ALTER TABLE bookedradar.recovery_events DROP CONSTRAINT recovery_events_tenant_id_idempotency_key_key');
    await pool.query('DROP INDEX bookedradar.recovery_events_tenant_idempotency_idx');
    await pool.query('ALTER TABLE bookedradar.recovery_events ADD CONSTRAINT recovery_events_idempotency_key_key UNIQUE (idempotency_key)');
    await reject(/migration_required/);
    await applyPostgresSchema(pool,schema);
    assert.equal((await verifyPostgresReleaseSchema(pool)).ok,true);
    // Enforce PostgreSQL read-only mode, not merely a query-string assertion.
    const client=await pool.connect();
    try {
      await client.query('SET default_transaction_read_only=on');
      assert.equal((await verifyPostgresReleaseSchema({connect:async()=>({query:(...args)=>client.query(...args),release(){}})})).ok,true);
    } finally { await client.query('SET default_transaction_read_only=off'); client.release(); }
    await assert.rejects(createPostgresServerStores({connectionString,mode:'production',migrationId:'unvalidated',snapshotFingerprint:'a'.repeat(64)}),/validated_migration_missing/);
  } finally { await pool.query('DROP SCHEMA IF EXISTS bookedradar CASCADE'); await pool.end(); }
});
