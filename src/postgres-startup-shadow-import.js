import { runPostgresShadowMigration } from "../scripts/postgres-shadow-migrate.mjs";

export async function runStartupShadowImport({
  enabled = false,
  env = process.env,
  runMigration = runPostgresShadowMigration,
  log = () => {},
} = {}) {
  if (!enabled) {
    return { enabled: false, status: "disabled" };
  }

  try {
    const result = await runMigration(env);
    const summary = {
      enabled: true,
      status: result.ok ? result.stage : "failed",
      ok: Boolean(result.ok),
      stage: result.stage || null,
      error: result.error || null,
      databaseTouched: Boolean(result.databaseTouched),
      cutoverPerformed: Boolean(result.cutoverPerformed),
      audit: result.audit ? {
        counts: result.audit.counts || null,
        warningCount: Number(result.audit.warningCount ?? result.audit.warnings?.length ?? 0),
        snapshotFingerprint: result.audit.snapshotFingerprint || null,
      } : null,
      reconciliation: result.reconciliation ? {
        ok: Boolean(result.reconciliation.ok),
        mismatches: result.reconciliation.mismatches || [],
        expected: result.reconciliation.expected || null,
        actual: result.reconciliation.actual || null,
      } : null,
      migrationId: result.imported?.migrationId || null,
    };
    log("postgres_shadow_import.startup", summary);
    return summary;
  } catch (error) {
    const summary = {
      enabled: true,
      status: "failed",
      ok: false,
      error: String(error?.message || "postgres_shadow_import_failed").slice(0, 200),
      databaseTouched: false,
      cutoverPerformed: false,
      audit: null,
      reconciliation: null,
      migrationId: null,
    };
    log("postgres_shadow_import.startup", summary);
    return summary;
  }
}
