import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Pool } from 'pg';
import { PostgresRecoveryStore } from '../src/postgres-recovery-store.js';
import { RecoveryEngine } from '../src/recovery/engine.js';
import { validateExistingLabDatabase } from '../scripts/private-voice-lab-start.mjs';
import { runSmsPersistenceRehearsal, TABLE_KEYS } from '../scripts/lib/private-lab-sms-rehearsal-core.mjs';

const connectionString = process.env.POSTGRES_TEST_URL;
// This test may create/reset a disposable schema. The deployed CLI NEVER imports
// this file, and its private-service/host/name guards have no CI bypass argument.
test('real Postgres: private SMS rehearsal cleans success and failed partial runs, preserving every pre-existing recovery row',
  { skip: !connectionString, timeout: 180000 }, async () => {
    const url = new URL(connectionString);
    assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
    assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
    assert.equal(url.pathname, '/bookedradar_test');
    assert.equal(url.search, ''); assert.equal(url.hash, '');
    const pool = new Pool({ connectionString, max: 4, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
    const snapshot = async () => {
      const data = {};
      for (const [table, key] of Object.entries(TABLE_KEYS)) {
        data[table] = (await pool.query(`SELECT to_jsonb(t) AS row FROM bookedradar.${table} t ORDER BY ${key},tenant_id`)).rows;
      }
      return data;
    };
    try {
      await pool.query('DROP SCHEMA IF EXISTS bookedradar CASCADE');
      await pool.query(await fs.readFile(new URL('../db/postgres-schema.sql', import.meta.url), 'utf8'));
      const fingerprint = 'a'.repeat(64);
      await pool.query(`INSERT INTO bookedradar.migration_runs(migration_id,source_snapshot_sha256,started_at,status,counts,validation)
        VALUES($1,$2,now(),'validated','{}',$3)`, ['private_voice_lab_empty_20260929', fingerprint,
        { tableCounts: { ok: true }, content: { ok: true } }]);
      assert.equal(await validateExistingLabDatabase(pool), fingerprint);
      const migrationBefore = (await pool.query('SELECT * FROM bookedradar.migration_runs')).rows;
      const tenant = { tenantId: 'pre-existing-ci-sentinel' }, store = new PostgresRecoveryStore(pool, tenant.tenantId);
      const engine = new RecoveryEngine({ store, tenant });
      const lead = await engine.ingest({ idempotencyKey: 'sentinel-event', type: 'phone_lead',
        contact: { phone: '+12025550101', transactionalSmsAllowed: true } });
      await engine.markRecovered(lead.opportunity.id, { bookingId: 'sentinel-booking' });
      const before = await snapshot();
      for (const rows of Object.values(before)) assert.ok(rows.length > 0, 'each recovery table has sentinel rows');

      const result = await runSmsPersistenceRehearsal(pool);
      assert.equal(result.ok, true); assert.equal(result.syntheticRowsRemaining, 0);
      assert.ok(result.deletedFixtureRows > 0); assert.ok(result.attemptedFixtureRows <= 160);
      assert.ok(Object.values(result.coverage).every(value => value === true));
      assert.equal(result.providerCalls, 0); assert.equal(result.providerAcceptanceVerified, false);
      assert.equal(result.deliveryVerified, false); assert.equal(result.databaseSequenceMayAdvance, true);
      assert.deepEqual(await snapshot(), before);

      // A COMMIT can succeed even when its response is lost. The exact insert
      // allowlist must still remove the committed partial fixture in finally.
      let inject = true;
      const ambiguousPool = { query: pool.query.bind(pool), async connect() {
        const client = await pool.connect();
        return { async query(sql, values) {
          const result = await client.query(sql, values);
          if (inject && sql === 'COMMIT') { inject = false; throw new Error('synthetic_lost_commit_response'); }
          return result;
        }, release() { client.release(); } };
      } };
      await assert.rejects(runSmsPersistenceRehearsal(ambiguousPool), error => {
        assert.equal(error.message, 'sms_rehearsal_checks_failed');
        assert.equal(error.cleanupVerified, true); return true;
      });
      assert.equal(inject, false); assert.deepEqual(await snapshot(), before);
      assert.deepEqual((await pool.query('SELECT * FROM bookedradar.migration_runs')).rows, migrationBefore);
    } finally { await pool.end(); }
  });
