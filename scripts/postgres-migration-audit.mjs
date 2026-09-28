import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { auditPostgresMigrationSnapshot } from "../src/postgres-migration-audit.js";

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function readJsonl(file) {
  try {
    const raw = await fs.readFile(file, "utf8");
    return raw.split("\n").filter(line => line.trim()).map(line => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export async function loadMigrationSnapshot(env = process.env) {
  const stateFile = path.resolve(env.STATE_FILE || "./data/state.json");
  const dataDir = path.dirname(stateFile);
  return {
    state: await readJson(stateFile),
    recovery: await readJson(path.resolve(env.RECOVERY_STATE_FILE || "./data/recovery-state.json")),
    callHistory: await readJson(path.resolve(env.CALL_HISTORY_FILE || "./data/call-history.json")),
    webChat: await readJson(path.resolve(env.WEB_CHAT_STATE_FILE || "./data/web-chat.json")),
    transfers: await readJson(path.join(dataDir, "voice-transfers.json")),
    growthMetrics: await readJson(path.resolve(env.GROWTH_METRICS_FILE || "./data/growth-metrics.json")),
    billingTest: await readJson(path.join(dataDir, "billing-test-state.json")),
    billingLive: await readJson(path.join(dataDir, "billing-live-state.json")),
    leads: await readJsonl(path.resolve(env.LEADS_FILE || "./data/leads.jsonl")),
  };
}

export async function main(env = process.env) {
  const snapshot = await loadMigrationSnapshot(env);
  const audit = auditPostgresMigrationSnapshot(snapshot);
  console.log(JSON.stringify({
    event: "postgres_migration.audit",
    ok: audit.ok,
    counts: audit.counts,
    errorCount: audit.errors.length,
    warningCount: audit.warnings.length,
    errors: audit.errors,
    warnings: audit.warnings,
    snapshotFingerprint: audit.snapshotFingerprint,
  }));
  if (!audit.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(JSON.stringify({
      event: "postgres_migration.audit",
      ok: false,
      error: String(error?.message || "postgres_migration_audit_failed"),
    }));
    process.exitCode = 1;
  });
}
