import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { createPostgresPool } from "./postgres-runtime.js";
import { readPostgresSnapshot } from "./postgres-full-export.js";
import { stableHash } from "./postgres-migration-audit.js";
import { loadMigrationSnapshot } from "../scripts/postgres-migration-audit.mjs";

function bool(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

function safeId(value) {
  const id = String(value || "").trim();
  if (!/^[a-zA-Z0-9_-]{8,120}$/.test(id)) {
    throw new Error("postgres_json_rollback_id_invalid");
  }
  return id;
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function atomicWrite(file, content, rollbackId) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.rollback-${rollbackId}.tmp`;
  await fs.writeFile(temp, content, { encoding: "utf8", mode: 0o600 });
  return temp;
}

function json(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

function jsonl(rows) {
  return (rows || []).map(row => JSON.stringify(row) + "\n").join("");
}

export function rollbackJsonTargets(env = process.env) {
  const stateFile = path.resolve(env.STATE_FILE || "./data/state.json");
  const dataDir = path.dirname(stateFile);
  return [
    { key:"state", file:stateFile, valueKey:"state", format:"json" },
    { key:"recovery", file:path.resolve(env.RECOVERY_STATE_FILE || "./data/recovery-state.json"), valueKey:"recovery", format:"json" },
    { key:"callHistory", file:path.resolve(env.CALL_HISTORY_FILE || "./data/call-history.json"), valueKey:"callHistory", format:"json" },
    { key:"webChat", file:path.resolve(env.WEB_CHAT_STATE_FILE || "./data/web-chat.json"), valueKey:"webChat", format:"json" },
    { key:"growthMetrics", file:path.resolve(env.GROWTH_METRICS_FILE || "./data/growth-metrics.json"), valueKey:"growthMetrics", format:"json" },
    { key:"leads", file:path.resolve(env.LEADS_FILE || "./data/leads.jsonl"), valueKey:"leads", format:"jsonl" },
    { key:"transfers", file:path.join(dataDir, "voice-transfers.json"), valueKey:"transfers", format:"json" },
    { key:"billingTest", file:path.join(dataDir, "billing-test-state.json"), valueKey:"billingTest", format:"json", nullable:true },
    { key:"billingLive", file:path.join(dataDir, "billing-live-state.json"), valueKey:"billingLive", format:"json", nullable:true },
  ];
}

async function restoreBackup(targets, backupDir, manifest) {
  for (const target of targets) {
    const item = manifest.files[target.key];
    if (item?.existed) {
      await fs.copyFile(path.join(backupDir, `${target.key}.bak`), target.file);
      await fs.chmod(target.file, 0o600).catch(() => {});
    } else {
      await fs.rm(target.file, { force: true });
    }
  }
}

export async function syncPostgresSnapshotToJson({
  env = process.env,
  createPool = createPostgresPool,
  readSnapshot = readPostgresSnapshot,
  loadJsonSnapshot = loadMigrationSnapshot,
} = {}) {
  if (String(env.BOOKEDRADAR_STORAGE_BACKEND || "json").trim() !== "json") {
    throw new Error("postgres_json_rollback_requires_json_backend");
  }
  if (!bool(env.POSTGRES_JSON_ROLLBACK_ARMED)) {
    throw new Error("postgres_json_rollback_not_armed");
  }
  if (bool(env.POSTGRES_SHADOW_IMPORT_ON_STARTUP) || bool(env.POSTGRES_MIGRATION_ARMED)) {
    throw new Error("postgres_json_rollback_requires_migration_disarmed");
  }

  const connectionString = String(env.DATABASE_URL || "").trim();
  if (!connectionString) throw new Error("database_url_required");
  const url = new URL(connectionString);
  if (
    !["postgres:","postgresql:"].includes(url.protocol) ||
    ["localhost","127.0.0.1","[::1]"].includes(url.hostname) ||
    url.pathname === "/bookedradar_test"
  ) {
    throw new Error("postgres_json_rollback_requires_managed_database");
  }

  const rollbackId = safeId(
    env.POSTGRES_JSON_ROLLBACK_ID ||
    `rollback_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`
  );

  const pool = createPool({
    connectionString,
    max:1,
    connectionTimeoutMillis:Number(env.POSTGRES_HEALTH_TIMEOUT_MS || 5000),
  });

  let snapshot;
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      snapshot = await readSnapshot(client);
      await client.query("COMMIT");
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }

  const sourceHash = stableHash(snapshot);
  const targets = rollbackJsonTargets(env);
  const stateTarget = targets.find(target => target.key === "state");
  const backupDir = path.join(
    path.dirname(stateTarget.file),
    `.postgres-json-rollback-${rollbackId}`
  );
  await fs.mkdir(backupDir, { recursive:true, mode:0o700 });

  const manifest = {
    rollbackId,
    sourceHash,
    createdAt:new Date().toISOString(),
    files:{},
  };
  const staged = new Map();

  for (const target of targets) {
    const originalExists = await exists(target.file);
    manifest.files[target.key] = {
      path:target.file,
      existed:originalExists,
      delete:target.nullable && snapshot[target.valueKey] == null,
    };
    if (originalExists) {
      await fs.copyFile(target.file, path.join(backupDir, `${target.key}.bak`));
      await fs.chmod(path.join(backupDir, `${target.key}.bak`), 0o600).catch(() => {});
    }

    const value = snapshot[target.valueKey];
    if (target.nullable && value == null) continue;
    const body = target.format === "jsonl" ? jsonl(value) : json(value);
    staged.set(target.key, await atomicWrite(target.file, body, rollbackId));
  }

  await fs.writeFile(
    path.join(backupDir, "manifest.json"),
    json(manifest),
    { encoding:"utf8", mode:0o600 }
  );

  let committed = false;
  try {
    for (const target of targets) {
      const value = snapshot[target.valueKey];
      if (target.nullable && value == null) {
        await fs.rm(target.file, { force:true });
        continue;
      }
      const temp = staged.get(target.key);
      if (!temp) throw new Error("postgres_json_rollback_stage_missing");
      await fs.rename(temp, target.file);
      await fs.chmod(target.file, 0o600).catch(() => {});
    }
    committed = true;

    const restored = await loadJsonSnapshot(env);
    const restoredHash = stableHash(restored);
    if (restoredHash !== sourceHash) {
      throw new Error("postgres_json_rollback_content_mismatch");
    }

    return {
      ok:true,
      rollbackId,
      sourceHash,
      restoredHash,
      backupDir,
      filesWritten:targets.filter(target => !(target.nullable && snapshot[target.valueKey] == null)).length,
      filesDeleted:targets.filter(target => target.nullable && snapshot[target.valueKey] == null).length,
      databaseTouched:false,
      postgresAuthoritative:false,
    };
  } catch (error) {
    if (committed) {
      await restoreBackup(targets, backupDir, manifest);
    }
    throw error;
  } finally {
    for (const temp of staged.values()) {
      await fs.rm(temp, { force:true }).catch(() => {});
    }
  }
}

export async function runStartupPostgresJsonRollback({
  enabled = false,
  env = process.env,
  sync = syncPostgresSnapshotToJson,
  log = () => {},
} = {}) {
  if (!enabled) return { enabled:false, status:"disabled" };
  try {
    const report = await sync({ env });
    const result = {
      enabled:true,
      status:"validated",
      ok:true,
      rollbackId:report.rollbackId,
      sourceHash:report.sourceHash,
      restoredHash:report.restoredHash,
      filesWritten:report.filesWritten,
      filesDeleted:report.filesDeleted,
      backupDir:report.backupDir,
      databaseTouched:false,
      postgresAuthoritative:false,
    };
    log("postgres_json_rollback.startup", result);
    return result;
  } catch (error) {
    const result = {
      enabled:true,
      status:"failed",
      ok:false,
      error:String(error?.message || "postgres_json_rollback_failed").slice(0,200),
      databaseTouched:false,
      postgresAuthoritative:false,
    };
    log("postgres_json_rollback.startup", result);
    return result;
  }
}
