import test from "node:test";
import assert from "node:assert/strict";
import { runStartupMigrationAudit } from "../src/postgres-startup-migration-audit.js";

test("startup migration audit is inert when disabled", async () => {
  let loaded = false;
  const result = await runStartupMigrationAudit({
    enabled: false,
    loadSnapshot: async () => { loaded = true; return {}; },
  });
  assert.deepEqual(result, { enabled: false, status: "disabled" });
  assert.equal(loaded, false);
});

test("startup migration audit logs a clean read-only result", async () => {
  const logs = [];
  const snapshot = { synthetic: true };
  const result = await runStartupMigrationAudit({
    enabled: true,
    env: { STATE_FILE: "/synthetic/state.json" },
    loadSnapshot: async env => {
      assert.equal(env.STATE_FILE, "/synthetic/state.json");
      return snapshot;
    },
    auditSnapshot: input => {
      assert.equal(input, snapshot);
      return {
        ok: true,
        counts: { voiceCalls: 3 },
        errors: [],
        warnings: [{ code: "legacy_warning" }],
        snapshotFingerprint: "a".repeat(64),
      };
    },
    log: (event, fields) => logs.push({ event, ...fields }),
  });

  assert.equal(result.status, "clean");
  assert.equal(result.ok, true);
  assert.equal(result.databaseTouched, false);
  assert.equal(result.cutoverPerformed, false);
  assert.equal(result.warningCount, 1);
  assert.equal(logs[0].event, "postgres_migration.startup_audit");
});

test("startup migration audit reports issues without throwing or touching Postgres", async () => {
  const result = await runStartupMigrationAudit({
    enabled: true,
    loadSnapshot: async () => ({}),
    auditSnapshot: () => ({
      ok: false,
      counts: { leads: 2 },
      errors: [{ code: "lead_missing_tenant" }],
      warnings: [],
      snapshotFingerprint: "b".repeat(64),
    }),
  });

  assert.equal(result.status, "issues_found");
  assert.equal(result.ok, false);
  assert.equal(result.errorCount, 1);
  assert.equal(result.databaseTouched, false);
  assert.equal(result.cutoverPerformed, false);
});

test("startup migration audit catches read failures and never crashes startup", async () => {
  const logs = [];
  const result = await runStartupMigrationAudit({
    enabled: true,
    loadSnapshot: async () => { throw new Error("synthetic_read_failure"); },
    log: (event, fields) => logs.push({ event, ...fields }),
  });

  assert.equal(result.status, "failed");
  assert.equal(result.ok, false);
  assert.equal(result.error, "synthetic_read_failure");
  assert.equal(result.databaseTouched, false);
  assert.equal(result.cutoverPerformed, false);
  assert.equal(logs[0].event, "postgres_migration.startup_audit");
});
