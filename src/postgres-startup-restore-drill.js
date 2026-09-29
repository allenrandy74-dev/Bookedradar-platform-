import fs from "node:fs/promises";
import path from "node:path";
import { createPostgresPool } from "./postgres-runtime.js";
import { runPostgresTransactionalRestoreDrill } from "./postgres-restore-drill.js";

export async function runStartupPostgresRestoreDrill({
  enabled = false,
  env = process.env,
  createPool = createPostgresPool,
  runDrill = runPostgresTransactionalRestoreDrill,
  readFile = fs.readFile,
  log = () => {},
} = {}) {
  if (!enabled) return { enabled:false, status:"disabled" };

  const backend = String(env.BOOKEDRADAR_STORAGE_BACKEND || "json").trim();
  if (backend !== "json") {
    const result = {
      enabled:true,
      status:"refused",
      ok:false,
      error:"restore_drill_requires_json_authority",
      databaseChanged:false,
      cutoverPerformed:false,
    };
    log("postgres_restore_drill.startup", result);
    return result;
  }

  if (
    String(env.POSTGRES_SHADOW_IMPORT_ON_STARTUP || "false").toLowerCase() === "true" ||
    String(env.POSTGRES_MIGRATION_ARMED || "false").toLowerCase() === "true"
  ) {
    const result = {
      enabled:true,
      status:"refused",
      ok:false,
      error:"restore_drill_requires_migration_disarmed",
      databaseChanged:false,
      cutoverPerformed:false,
    };
    log("postgres_restore_drill.startup", result);
    return result;
  }

  const databaseUrl = String(env.DATABASE_URL || "").trim();
  if (!databaseUrl) {
    const result = {
      enabled:true,
      status:"unconfigured",
      ok:false,
      error:"database_url_required",
      databaseChanged:false,
      cutoverPerformed:false,
    };
    log("postgres_restore_drill.startup", result);
    return result;
  }

  const pool = createPool({
    connectionString:databaseUrl,
    max:1,
    connectionTimeoutMillis:Number(env.POSTGRES_HEALTH_TIMEOUT_MS || 5000),
  });

  try {
    const schemaPath = path.resolve(env.POSTGRES_SCHEMA_FILE || "./db/postgres-schema.sql");
    const schemaSql = await readFile(schemaPath, "utf8");
    const report = await runDrill(pool, schemaSql, {
      drillId:String(env.POSTGRES_RESTORE_DRILL_ID || "").trim() ||
        `restore_${Date.now()}_startup`,
    });
    const result = {
      enabled:true,
      status:"validated",
      ok:true,
      drillId:report.drillId,
      sourceHash:report.sourceHash,
      restoredHash:report.restoredHash,
      reconciliation:{
        ok:Boolean(report.reconciliation?.ok),
        mismatches:report.reconciliation?.mismatches || [],
        expected:report.reconciliation?.expected || null,
        actual:report.reconciliation?.actual || null,
      },
      rollbackVerified:Boolean(report.rollbackVerified),
      elapsedMs:Number(report.elapsedMs || 0),
      databaseChanged:false,
      cutoverPerformed:false,
    };
    log("postgres_restore_drill.startup", result);
    return result;
  } catch (error) {
    const result = {
      enabled:true,
      status:"failed",
      ok:false,
      error:String(error?.message || "postgres_restore_drill_failed").slice(0,200),
      databaseChanged:false,
      cutoverPerformed:false,
    };
    log("postgres_restore_drill.startup", result);
    return result;
  } finally {
    await pool.end();
  }
}
