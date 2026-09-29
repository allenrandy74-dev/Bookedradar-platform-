import test from "node:test";
import assert from "node:assert/strict";
import {
  postgresBackendConfig,
  postgresLabConfig,
  providerAdaptersEnabledForStorage,
  validateProductionCutoverSourceAudit,
  verifyValidatedProductionMigration,
} from "../src/postgres-server-stores.js";

const fingerprint = "4de6c957e16a247a73cbff78cd2ce175044995b7e83fd0aecd1940bd120bd75e";
const migrationId = "production-shadow-20260929-final";

function productionEnv(overrides = {}) {
  return {
    BOOKEDRADAR_STORAGE_BACKEND: "postgres",
    POSTGRES_PRODUCTION_ARMED: "true",
    DATABASE_URL: "postgresql://bookedradar:secret@dpg-internal/bookedradar_postgres_production",
    POSTGRES_VALIDATED_MIGRATION_ID: migrationId,
    POSTGRES_VALIDATED_SNAPSHOT_FINGERPRINT: fingerprint,
    ...overrides,
  };
}

test("production Postgres config is explicit and preserves JSON as default", () => {
  assert.equal(postgresBackendConfig({}), null);
  const config = postgresBackendConfig(productionEnv());
  assert.equal(config.mode, "production");
  assert.equal(config.migrationId, migrationId);
  assert.equal(config.snapshotFingerprint, fingerprint);
  assert.match(config.connectionString, /^postgresql:\/\//);
});

test("production Postgres config refuses unarmed, local, and unvalidated activation", () => {
  assert.throws(
    () => postgresBackendConfig(productionEnv({ POSTGRES_PRODUCTION_ARMED: "false" })),
    /postgres_production_not_armed/
  );
  assert.throws(
    () => postgresBackendConfig(productionEnv({
      DATABASE_URL: "postgresql://user:pass@127.0.0.1:5432/bookedradar_test",
    })),
    /postgres_production_requires_managed_database/
  );
  assert.throws(
    () => postgresBackendConfig(productionEnv({ POSTGRES_VALIDATED_MIGRATION_ID: "" })),
    /postgres_validated_migration_id_required/
  );
  assert.throws(
    () => postgresBackendConfig(productionEnv({ POSTGRES_VALIDATED_SNAPSHOT_FINGERPRINT: "bad" })),
    /postgres_validated_snapshot_fingerprint_required/
  );
});

test("lab config remains isolated and production integrations stay enabled", () => {
  const lab = postgresLabConfig({
    BOOKEDRADAR_STORAGE_BACKEND: "postgres_lab",
    DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/bookedradar_test",
    VOICE_ENABLED: "false",
    DISPATCH_ENABLED: "false",
    BOOKEDRADAR_BILLING_ENABLED: "false",
    DEMO_NUMBER_PROVISION_MODE: "off",
  });
  assert.equal(lab.mode, "lab");
  assert.equal(providerAdaptersEnabledForStorage(lab), false);
  assert.equal(providerAdaptersEnabledForStorage({ mode: "production" }), true);
  assert.equal(providerAdaptersEnabledForStorage(null), true);
});

test("validated migration gate requires exact status fingerprint and reconciliation evidence", async () => {
  const goodRow = {
    migration_id: migrationId,
    source_snapshot_sha256: fingerprint,
    status: "validated",
    validation: {
      tableCounts: { ok: true, mismatches: [] },
      content: {
        ok: true,
        sourceContentHash: "abc",
        postgresContentHash: "abc",
      },
    },
  };
  const pool = {
    async query(_sql, values) {
      assert.deepEqual(values, [migrationId]);
      return { rows: [goodRow] };
    },
  };
  const result = await verifyValidatedProductionMigration(pool, {
    migrationId,
    snapshotFingerprint: fingerprint,
  });
  assert.deepEqual(result, {
    migrationId,
    snapshotFingerprint: fingerprint,
    validated: true,
  });

  await assert.rejects(
    verifyValidatedProductionMigration({ query: async () => ({ rows: [] }) }, { migrationId, snapshotFingerprint: fingerprint }),
    /postgres_validated_migration_missing/
  );
  await assert.rejects(
    verifyValidatedProductionMigration({ query: async () => ({ rows: [{ ...goodRow, status: "imported" }] }) }, { migrationId, snapshotFingerprint: fingerprint }),
    /postgres_validated_migration_status_invalid/
  );
  await assert.rejects(
    verifyValidatedProductionMigration({ query: async () => ({ rows: [{ ...goodRow, source_snapshot_sha256: "f".repeat(64) }] }) }, { migrationId, snapshotFingerprint: fingerprint }),
    /postgres_validated_migration_fingerprint_mismatch/
  );
  await assert.rejects(
    verifyValidatedProductionMigration({ query: async () => ({ rows: [{ ...goodRow, validation: { tableCounts:{ok:true}, content:{ok:false} } }] }) }, { migrationId, snapshotFingerprint: fingerprint }),
    /postgres_validated_migration_reconciliation_invalid/
  );
});

test("frozen JSON source audit must be clean and match the validated snapshot exactly", () => {
  assert.deepEqual(
    validateProductionCutoverSourceAudit({
      ok: true,
      errorCount: 0,
      warningCount: 0,
      snapshotFingerprint: fingerprint,
    }, fingerprint),
    { ok: true, snapshotFingerprint: fingerprint }
  );

  assert.throws(
    () => validateProductionCutoverSourceAudit({ ok:false, snapshotFingerprint:fingerprint }, fingerprint),
    /postgres_cutover_source_audit_failed/
  );
  assert.throws(
    () => validateProductionCutoverSourceAudit({ ok:true, errorCount:0, warningCount:0, snapshotFingerprint:"f".repeat(64) }, fingerprint),
    /postgres_cutover_source_fingerprint_mismatch/
  );
  assert.throws(
    () => validateProductionCutoverSourceAudit({ ok:true, errorCount:0, warningCount:1, snapshotFingerprint:fingerprint }, fingerprint),
    /postgres_cutover_source_audit_not_clean/
  );
});
