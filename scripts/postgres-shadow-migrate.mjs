import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  auditPostgresMigrationSnapshot,
  buildPostgresMigrationManifest,
} from "../src/postgres-migration-audit.js";
import { loadMigrationSnapshot } from "./postgres-migration-audit.mjs";
import {
  applyPostgresSchema,
  createPostgresPool,
  importMigrationManifest,
  postgresHealth,
  reconcileMigration,
} from "../src/postgres-runtime.js";

function flag(env, name, defaultValue = false) {
  const value = String(env[name] ?? (defaultValue ? "true" : "false")).trim().toLowerCase();
  return value === "true";
}

export async function runPostgresShadowMigration(env = process.env) {
  const snapshot = await loadMigrationSnapshot(env);
  const audit = auditPostgresMigrationSnapshot(snapshot);
  const dryRun = !flag(env, "POSTGRES_MIGRATION_DRY_RUN", true) ? false : true;
  const armed = flag(env, "POSTGRES_MIGRATION_ARMED", false);
  const allowWarnings = flag(env, "POSTGRES_MIGRATION_ALLOW_WARNINGS", false);

  if (!audit.ok) {
    return {
      ok: false,
      stage: "audit",
      dryRun,
      armed,
      audit,
      error: "migration_audit_failed",
    };
  }

  if (audit.warnings.length && !allowWarnings) {
    return {
      ok: false,
      stage: "audit",
      dryRun,
      armed,
      audit,
      error: "migration_warnings_require_review",
    };
  }

  const manifest = buildPostgresMigrationManifest(snapshot);

  const expectedFingerprint = String(env.POSTGRES_MIGRATION_EXPECTED_FINGERPRINT || "").trim().toLowerCase();
  if (expectedFingerprint && expectedFingerprint !== manifest.snapshotFingerprint.toLowerCase()) {
    return {
      ok: false,
      stage: "fingerprint",
      dryRun,
      armed,
      audit: {
        counts: audit.counts,
        warningCount: audit.warnings.length,
        snapshotFingerprint: audit.snapshotFingerprint,
      },
      expectedFingerprint,
      actualFingerprint: manifest.snapshotFingerprint,
      error: "migration_snapshot_fingerprint_mismatch",
      databaseTouched: false,
      cutoverPerformed: false,
    };
  }

  if (dryRun || !armed) {
    return {
      ok: true,
      stage: "dry_run",
      dryRun: true,
      armed,
      audit,
      manifest: {
        version: manifest.version,
        counts: manifest.counts,
        snapshotFingerprint: manifest.snapshotFingerprint,
      },
      databaseTouched: false,
      cutoverPerformed: false,
    };
  }

  const databaseUrl = String(env.DATABASE_URL || "").trim();
  if (!databaseUrl) {
    return {
      ok: false,
      stage: "connect",
      dryRun: false,
      armed: true,
      error: "database_url_required",
      databaseTouched: false,
      cutoverPerformed: false,
    };
  }

  const pool = createPostgresPool({
    connectionString: databaseUrl,
    max: Number(env.POSTGRES_POOL_MAX || 5),
  });

  const migrationId =
    String(env.POSTGRES_MIGRATION_ID || "").trim() ||
    `shadow_${Date.now()}_${manifest.snapshotFingerprint.slice(0, 12)}`;

  try {
    const health = await postgresHealth(pool);
    const schemaPath = path.resolve(
      env.POSTGRES_SCHEMA_FILE || "./db/postgres-schema.sql"
    );
    const schemaSql = await fs.readFile(schemaPath, "utf8");
    await applyPostgresSchema(pool, schemaSql);
    const imported = await importMigrationManifest(pool, manifest, { migrationId });
    const reconciliation = await reconcileMigration(pool, manifest);

    if (!reconciliation.ok) {
      return {
        ok: false,
        stage: "reconcile",
        dryRun: false,
        armed: true,
        health,
        audit,
        imported,
        reconciliation,
        error: "postgres_reconciliation_failed",
        databaseTouched: true,
        cutoverPerformed: false,
      };
    }

    await pool.query(
      `UPDATE bookedradar.migration_runs
       SET status='validated', validation=$2::jsonb, completed_at=COALESCE(completed_at, now())
       WHERE migration_id=$1`,
      [migrationId, JSON.stringify(reconciliation)]
    );

    return {
      ok: true,
      stage: "validated_shadow",
      dryRun: false,
      armed: true,
      health,
      audit: {
        counts: audit.counts,
        warningCount: audit.warnings.length,
        snapshotFingerprint: audit.snapshotFingerprint,
      },
      imported,
      reconciliation,
      databaseTouched: true,
      cutoverPerformed: false,
    };
  } finally {
    await pool.end();
  }
}

export async function main(env = process.env) {
  const result = await runPostgresShadowMigration(env);
  console.log(JSON.stringify({ event: "postgres_shadow_migration", ...result }));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(JSON.stringify({
      event: "postgres_shadow_migration",
      ok: false,
      error: String(error?.message || "postgres_shadow_migration_failed"),
      cutoverPerformed: false,
    }));
    process.exitCode = 1;
  });
}
