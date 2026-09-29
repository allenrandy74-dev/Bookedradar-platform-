import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runPostgresShadowMigration } from "../scripts/postgres-shadow-migrate.mjs";
import { loadMigrationSnapshot } from "../scripts/postgres-migration-audit.mjs";

async function fixture(t, { badLead = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "br-postgres-shadow-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const state = path.join(root, "state.json");
  const recovery = path.join(root, "recovery-state.json");
  const history = path.join(root, "call-history.json");
  const chat = path.join(root, "web-chat.json");
  const growth = path.join(root, "growth-metrics.json");
  const leads = path.join(root, "leads.jsonl");

  await fs.writeFile(state, JSON.stringify({ processedWebhooks: {}, calls: {} }));
  await fs.writeFile(recovery, JSON.stringify({
    opportunities: {}, actions: {}, events: [], eventKeys: {}, contacts: {}, attribution: {},
  }));
  await fs.writeFile(history, JSON.stringify({ calls: {} }));
  await fs.writeFile(chat, JSON.stringify({ sessions: {} }));
  await fs.writeFile(growth, JSON.stringify({ counts: {}, updatedAt: null }));
  await fs.writeFile(leads, badLead
    ? JSON.stringify({ call_id: "call_without_tenant" }) + "\n"
    : "");

  return {
    STATE_FILE: state,
    RECOVERY_STATE_FILE: recovery,
    CALL_HISTORY_FILE: history,
    WEB_CHAT_STATE_FILE: chat,
    GROWTH_METRICS_FILE: growth,
    LEADS_FILE: leads,
  };
}

test("shadow migration defaults to dry-run and touches no database", async (t) => {
  const env = await fixture(t);
  const result = await runPostgresShadowMigration(env);
  assert.equal(result.ok, true);
  assert.equal(result.stage, "dry_run");
  assert.equal(result.dryRun, true);
  assert.equal(result.databaseTouched, false);
  assert.equal(result.cutoverPerformed, false);
  assert.match(result.manifest.snapshotFingerprint, /^[a-f0-9]{64}$/);
});

test("shadow migration remains dry-run if dry-run is disabled but migration is not armed", async (t) => {
  const env = {
    ...(await fixture(t)),
    POSTGRES_MIGRATION_DRY_RUN: "false",
    POSTGRES_MIGRATION_ARMED: "false",
  };
  const result = await runPostgresShadowMigration(env);
  assert.equal(result.ok, true);
  assert.equal(result.stage, "dry_run");
  assert.equal(result.databaseTouched, false);
});

test("shadow migration refuses audit errors before database connection", async (t) => {
  const env = {
    ...(await fixture(t, { badLead: true })),
    POSTGRES_MIGRATION_DRY_RUN: "false",
    POSTGRES_MIGRATION_ARMED: "true",
    DATABASE_URL: "postgresql://should-not-be-used.invalid/test",
  };
  const result = await runPostgresShadowMigration(env);
  assert.equal(result.ok, false);
  assert.equal(result.stage, "audit");
  assert.equal(result.error, "migration_audit_failed");
  assert.equal(result.audit.errors.some(x => x.code === "lead_missing_tenant"), true);
});

test("armed non-dry migration requires a database URL", async (t) => {
  const env = {
    ...(await fixture(t)),
    POSTGRES_MIGRATION_DRY_RUN: "false",
    POSTGRES_MIGRATION_ARMED: "true",
  };
  const result = await runPostgresShadowMigration(env);
  assert.equal(result.ok, false);
  assert.equal(result.stage, "connect");
  assert.equal(result.error, "database_url_required");
  assert.equal(result.databaseTouched, false);
  assert.equal(result.cutoverPerformed, false);
});

test("shadow migration refuses a changed production snapshot before touching Postgres", async (t) => {
  const env = {
    ...(await fixture(t)),
    POSTGRES_MIGRATION_DRY_RUN: "false",
    POSTGRES_MIGRATION_ARMED: "true",
    POSTGRES_MIGRATION_EXPECTED_FINGERPRINT: "f".repeat(64),
    DATABASE_URL: "postgresql://should-not-be-used.invalid/test",
  };
  const result = await runPostgresShadowMigration(env);
  assert.equal(result.ok, false);
  assert.equal(result.stage, "fingerprint");
  assert.equal(result.error, "migration_snapshot_fingerprint_mismatch");
  assert.equal(result.databaseTouched, false);
  assert.equal(result.cutoverPerformed, false);
  assert.match(result.actualFingerprint, /^[a-f0-9]{64}$/);
});

test("migration snapshot normalizes a missing web-chat file to the runtime empty store", async (t) => {
  const env = await fixture(t);
  await fs.rm(env.WEB_CHAT_STATE_FILE, { force: true });
  const snapshot = await loadMigrationSnapshot(env);
  assert.deepEqual(snapshot.webChat, { sessions: {} });
});
