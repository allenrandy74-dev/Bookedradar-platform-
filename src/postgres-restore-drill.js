import crypto from "node:crypto";
import {
  buildPostgresMigrationManifest,
  stableHash,
} from "./postgres-migration-audit.js";
import { readPostgresSnapshot } from "./postgres-full-export.js";
import {
  importMigrationManifest,
  reconcileMigration,
} from "./postgres-runtime.js";

function safeSchemaName(value) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value || "")) {
    throw new Error("restore_drill_schema_invalid");
  }
  return value;
}

export async function runPostgresTransactionalRestoreDrill(
  pool,
  schemaSql,
  {
    drillId = `restore_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
  } = {}
) {
  if (!pool?.connect) throw new Error("postgres_pool_required");
  if (!String(schemaSql || "").trim()) throw new Error("postgres_schema_required");
  if (!/^[a-zA-Z0-9_-]{8,120}$/.test(drillId)) throw new Error("restore_drill_id_invalid");

  const tempSchema = safeSchemaName(
    `br_restore_source_${crypto.randomBytes(6).toString("hex")}`
  );
  const client = await pool.connect();
  const startedAt = Date.now();
  let inTransaction = false;
  let sourceHash = null;
  let restoredHash = null;
  let reconciliation = null;
  let rollbackVerified = false;

  try {
    await client.query(
      "SELECT pg_advisory_lock(hashtext('bookedradar_restore_drill'))"
    );

    const preflight = await client.query(
      "SELECT to_regnamespace('bookedradar') AS source_schema, to_regnamespace($1) AS temp_schema",
      [tempSchema]
    );
    if (!preflight.rows?.[0]?.source_schema) throw new Error("restore_drill_source_schema_missing");
    if (preflight.rows?.[0]?.temp_schema) throw new Error("restore_drill_temp_schema_exists");

    await client.query("BEGIN");
    inTransaction = true;
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='30s'");

    const sourceSnapshot = await readPostgresSnapshot(client);
    sourceHash = stableHash(sourceSnapshot);
    const manifest = buildPostgresMigrationManifest(sourceSnapshot);

    await client.query(`ALTER SCHEMA bookedradar RENAME TO ${tempSchema}`);
    await client.query(String(schemaSql));

    await importMigrationManifest(pool, manifest, {
      migrationId: drillId,
      client,
      manageTransaction: false,
    });

    reconciliation = await reconcileMigration(client, manifest);
    if (!reconciliation.ok) throw new Error("restore_drill_count_reconciliation_failed");

    const restoredSnapshot = await readPostgresSnapshot(client);
    restoredHash = stableHash(restoredSnapshot);
    if (sourceHash !== restoredHash) {
      throw new Error("restore_drill_content_reconciliation_failed");
    }

    // A successful drill must still leave the managed shadow database untouched.
    await client.query("ROLLBACK");
    inTransaction = false;

    const postflight = await client.query(
      "SELECT to_regnamespace('bookedradar') AS source_schema, to_regnamespace($1) AS temp_schema",
      [tempSchema]
    );
    rollbackVerified = Boolean(postflight.rows?.[0]?.source_schema) &&
      !postflight.rows?.[0]?.temp_schema;
    if (!rollbackVerified) throw new Error("restore_drill_rollback_verification_failed");

    const afterSnapshot = await readPostgresSnapshot(client);
    if (stableHash(afterSnapshot) !== sourceHash) {
      throw new Error("restore_drill_source_changed");
    }

    return {
      ok: true,
      drillId,
      sourceHash,
      restoredHash,
      reconciliation,
      rollbackVerified,
      elapsedMs: Date.now() - startedAt,
      databaseChanged: false,
      cutoverPerformed: false,
    };
  } catch (error) {
    if (inTransaction) {
      try {
        await client.query("ROLLBACK");
        inTransaction = false;
      } catch {}
    }
    throw error;
  } finally {
    try {
      await client.query(
        "SELECT pg_advisory_unlock(hashtext('bookedradar_restore_drill'))"
      );
    } catch {}
    client.release();
  }
}
