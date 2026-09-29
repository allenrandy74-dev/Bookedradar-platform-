import { loadMigrationSnapshot } from "../scripts/postgres-migration-audit.mjs";
import { createPostgresPool } from "./postgres-runtime.js";
import { readPostgresSnapshot } from "./postgres-full-export.js";
import { diagnoseMigrationDifference } from "./postgres-migration-diff.js";

export async function runStartupMigrationDiff({
  enabled = false,
  env = process.env,
  loadSnapshot = loadMigrationSnapshot,
  createPool = createPostgresPool,
  readSnapshot = readPostgresSnapshot,
  diagnose = diagnoseMigrationDifference,
  log = () => {},
} = {}) {
  if (!enabled) return { enabled:false, status:"disabled" };

  const databaseUrl = String(env.DATABASE_URL || "").trim();
  if (!databaseUrl) {
    const result = {
      enabled:true,
      status:"unconfigured",
      ok:false,
      error:"database_url_required",
      databaseTouched:false,
      cutoverPerformed:false,
    };
    log("postgres_migration.diff", result);
    return result;
  }

  let pool;
  try {
    const sourceSnapshot = await loadSnapshot(env);
    pool = createPool({ connectionString:databaseUrl, max:1, connectionTimeoutMillis:5000 });
    const client = await pool.connect();
    let postgresSnapshot;
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      postgresSnapshot = await readSnapshot(client);
      await client.query("COMMIT");
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally {
      client.release();
    }

    const diagnosis = diagnose(sourceSnapshot, postgresSnapshot);
    const result = {
      enabled:true,
      status:diagnosis.equal ? "equal" : "differences_found",
      ok:true,
      equal:diagnosis.equal,
      sourceHash:diagnosis.sourceHash,
      postgresHash:diagnosis.postgresHash,
      mismatchCount:diagnosis.mismatchCount,
      mismatches:diagnosis.mismatches,
      databaseTouched:false,
      cutoverPerformed:false,
    };
    log("postgres_migration.diff", result);
    return result;
  } catch (error) {
    const result = {
      enabled:true,
      status:"failed",
      ok:false,
      error:String(error?.message || "postgres_migration_diff_failed").slice(0,200),
      databaseTouched:false,
      cutoverPerformed:false,
    };
    log("postgres_migration.diff", result);
    return result;
  } finally {
    if (pool) await pool.end();
  }
}
