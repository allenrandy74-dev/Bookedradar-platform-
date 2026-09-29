import test from "node:test";
import assert from "node:assert/strict";
import { runStartupPostgresRestoreDrill } from "../src/postgres-startup-restore-drill.js";

test("startup restore drill is inert when disabled", async () => {
  let created = false;
  const result = await runStartupPostgresRestoreDrill({
    enabled:false,
    createPool() {
      created = true;
      throw new Error("should_not_run");
    },
  });
  assert.deepEqual(result, { enabled:false, status:"disabled" });
  assert.equal(created, false);
});

test("startup restore drill refuses non-JSON authority", async () => {
  const result = await runStartupPostgresRestoreDrill({
    enabled:true,
    env:{
      BOOKEDRADAR_STORAGE_BACKEND:"postgres_lab",
      DATABASE_URL:"postgresql://user:secret@internal/db",
    },
  });
  assert.equal(result.status, "refused");
  assert.equal(result.error, "restore_drill_requires_json_authority");
  assert.equal(result.databaseChanged, false);
  assert.equal(result.cutoverPerformed, false);
});

test("startup restore drill refuses while migration writes are armed", async () => {
  const result = await runStartupPostgresRestoreDrill({
    enabled:true,
    env:{
      BOOKEDRADAR_STORAGE_BACKEND:"json",
      DATABASE_URL:"postgresql://user:secret@internal/db",
      POSTGRES_MIGRATION_ARMED:"true",
    },
  });
  assert.equal(result.status, "refused");
  assert.equal(result.error, "restore_drill_requires_migration_disarmed");
});

test("startup restore drill returns only safe validated metadata and closes pool", async () => {
  const secret = "postgresql://user:super-secret@internal/db";
  let ended = false;
  let capturedConfig = null;
  const pool = { async end() { ended = true; } };
  const logs = [];

  const result = await runStartupPostgresRestoreDrill({
    enabled:true,
    env:{
      BOOKEDRADAR_STORAGE_BACKEND:"json",
      DATABASE_URL:secret,
      POSTGRES_HEALTH_TIMEOUT_MS:"4000",
      POSTGRES_RESTORE_DRILL_ID:"restore_synthetic_01",
    },
    createPool(config) {
      capturedConfig = config;
      return pool;
    },
    readFile:async () => "CREATE SCHEMA bookedradar;",
    runDrill:async (receivedPool, schemaSql, options) => {
      assert.equal(receivedPool, pool);
      assert.equal(schemaSql, "CREATE SCHEMA bookedradar;");
      assert.equal(options.drillId, "restore_synthetic_01");
      return {
        ok:true,
        drillId:options.drillId,
        sourceHash:"a".repeat(64),
        restoredHash:"a".repeat(64),
        reconciliation:{
          ok:true,
          mismatches:[],
          expected:{ voiceCalls:39 },
          actual:{ voiceCalls:39 },
        },
        rollbackVerified:true,
        elapsedMs:42,
        databaseChanged:false,
        cutoverPerformed:false,
      };
    },
    log:(event, fields) => logs.push({event,...fields}),
  });

  assert.equal(capturedConfig.connectionString, secret);
  assert.equal(capturedConfig.max, 1);
  assert.equal(capturedConfig.connectionTimeoutMillis, 4000);
  assert.equal(ended, true);
  assert.equal(result.status, "validated");
  assert.equal(result.ok, true);
  assert.equal(result.rollbackVerified, true);
  assert.equal(result.databaseChanged, false);
  assert.equal(result.cutoverPerformed, false);
  assert.equal(JSON.stringify(result).includes("super-secret"), false);
  assert.equal(JSON.stringify(logs).includes("super-secret"), false);
});

test("startup restore drill catches failures and still closes pool", async () => {
  let ended = false;
  const pool = { async end() { ended = true; } };
  const result = await runStartupPostgresRestoreDrill({
    enabled:true,
    env:{
      BOOKEDRADAR_STORAGE_BACKEND:"json",
      DATABASE_URL:"postgresql://user:hidden@internal/db",
    },
    createPool() { return pool; },
    readFile:async () => "CREATE SCHEMA bookedradar;",
    runDrill:async () => { throw new Error("synthetic_restore_failure"); },
  });
  assert.equal(ended, true);
  assert.equal(result.status, "failed");
  assert.equal(result.ok, false);
  assert.equal(result.error, "synthetic_restore_failure");
  assert.equal(result.databaseChanged, false);
  assert.equal(result.cutoverPerformed, false);
  assert.equal(JSON.stringify(result).includes("hidden"), false);
});
