import test from "node:test";
import assert from "node:assert/strict";
import { runStartupShadowImport } from "../src/postgres-startup-shadow-import.js";

test("startup shadow import is inert when disabled", async () => {
  let ran = false;
  const result = await runStartupShadowImport({
    enabled: false,
    runMigration: async () => { ran = true; return {}; },
  });
  assert.deepEqual(result, { enabled: false, status: "disabled" });
  assert.equal(ran, false);
});

test("startup shadow import returns validated shadow summary without exposing DB credentials", async () => {
  const logs = [];
  const result = await runStartupShadowImport({
    enabled: true,
    env: { DATABASE_URL: "postgresql://user:secret@internal/db" },
    runMigration: async env => {
      assert.equal(env.DATABASE_URL.includes("secret"), true);
      return {
        ok: true,
        stage: "validated_shadow",
        databaseTouched: true,
        cutoverPerformed: false,
        audit: {
          counts: { voiceCalls: 39 },
          warningCount: 0,
          snapshotFingerprint: "a".repeat(64),
        },
        imported: { migrationId: "mig-1" },
        reconciliation: {
          ok: true,
          mismatches: [],
          expected: { voiceCalls: 39 },
          actual: { voiceCalls: 39 },
        },
      };
    },
    log: (event, fields) => logs.push({ event, ...fields }),
  });

  assert.equal(result.status, "validated_shadow");
  assert.equal(result.ok, true);
  assert.equal(result.databaseTouched, true);
  assert.equal(result.cutoverPerformed, false);
  assert.equal(result.reconciliation.ok, true);
  assert.equal(result.migrationId, "mig-1");
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.equal(JSON.stringify(logs).includes("secret"), false);
});

test("startup shadow import preserves fail-closed migration result and does not crash server", async () => {
  const result = await runStartupShadowImport({
    enabled: true,
    runMigration: async () => ({
      ok: false,
      stage: "fingerprint",
      error: "migration_snapshot_fingerprint_mismatch",
      databaseTouched: false,
      cutoverPerformed: false,
      audit: {
        counts: { leads: 121 },
        warningCount: 0,
        snapshotFingerprint: "b".repeat(64),
      },
    }),
  });
  assert.equal(result.status, "failed");
  assert.equal(result.ok, false);
  assert.equal(result.error, "migration_snapshot_fingerprint_mismatch");
  assert.equal(result.databaseTouched, false);
  assert.equal(result.cutoverPerformed, false);
});

test("startup shadow import catches unexpected exceptions and remains non-authoritative", async () => {
  const result = await runStartupShadowImport({
    enabled: true,
    runMigration: async () => { throw new Error("synthetic_import_failure"); },
  });
  assert.equal(result.status, "failed");
  assert.equal(result.ok, false);
  assert.equal(result.error, "synthetic_import_failure");
  assert.equal(result.databaseTouched, false);
  assert.equal(result.cutoverPerformed, false);
});
