import { loadMigrationSnapshot } from "../scripts/postgres-migration-audit.mjs";
import { auditPostgresMigrationSnapshot } from "./postgres-migration-audit.js";

export async function runStartupMigrationAudit({
  enabled = false,
  env = process.env,
  loadSnapshot = loadMigrationSnapshot,
  auditSnapshot = auditPostgresMigrationSnapshot,
  log = () => {},
} = {}) {
  if (!enabled) {
    return { enabled: false, status: "disabled" };
  }

  try {
    const snapshot = await loadSnapshot(env);
    const audit = auditSnapshot(snapshot);
    const result = {
      enabled: true,
      status: audit.ok ? "clean" : "issues_found",
      ok: Boolean(audit.ok),
      counts: audit.counts,
      errorCount: audit.errors.length,
      warningCount: audit.warnings.length,
      errors: audit.errors,
      warnings: audit.warnings,
      snapshotFingerprint: audit.snapshotFingerprint,
      databaseTouched: false,
      cutoverPerformed: false,
    };
    log("postgres_migration.startup_audit", result);
    return result;
  } catch (error) {
    const result = {
      enabled: true,
      status: "failed",
      ok: false,
      error: String(error?.message || "postgres_migration_audit_failed").slice(0, 200),
      databaseTouched: false,
      cutoverPerformed: false,
    };
    log("postgres_migration.startup_audit", result);
    return result;
  }
}
