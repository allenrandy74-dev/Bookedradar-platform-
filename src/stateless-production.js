function on(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

export function validateStatelessPostgresProduction(env = process.env) {
  const enabled = on(env.POSTGRES_STATELESS_MODE);
  if (!enabled) return { enabled:false, status:"disabled" };

  if (String(env.BOOKEDRADAR_STORAGE_BACKEND || "").trim() !== "postgres") {
    throw new Error("stateless_mode_requires_postgres_backend");
  }
  if (!on(env.POSTGRES_PRODUCTION_ARMED)) {
    throw new Error("stateless_mode_requires_postgres_production_armed");
  }
  if (!String(env.DATABASE_URL || "").trim()) {
    throw new Error("stateless_mode_requires_database_url");
  }

  const forbidden = [
    "POSTGRES_MIGRATION_AUDIT_ON_STARTUP",
    "POSTGRES_SHADOW_IMPORT_ON_STARTUP",
    "POSTGRES_MIGRATION_DIFF_ON_STARTUP",
    "POSTGRES_JSON_ROLLBACK_ON_STARTUP",
    "POSTGRES_JSON_ROLLBACK_ARMED",
    "POSTGRES_MIGRATION_ARMED",
  ].filter(key => on(env[key]));

  if (forbidden.length) {
    const error = new Error("stateless_mode_file_dependency_enabled");
    error.forbidden = forbidden;
    throw error;
  }

  const migrationId = String(env.POSTGRES_VALIDATED_MIGRATION_ID || "").trim();
  const fingerprint = String(env.POSTGRES_VALIDATED_SNAPSHOT_FINGERPRINT || "").trim().toLowerCase();
  if (!/^[a-zA-Z0-9_-]{8,160}$/.test(migrationId)) {
    throw new Error("stateless_mode_validated_migration_required");
  }
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
    throw new Error("stateless_mode_validated_fingerprint_required");
  }

  return {
    enabled:true,
    status:"ready",
    backend:"postgres",
    migrationId,
    snapshotFingerprint:fingerprint,
    fileAuthority:false,
  };
}
