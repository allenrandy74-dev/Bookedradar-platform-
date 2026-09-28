import { createPostgresPool, postgresHealth } from "./postgres-runtime.js";

export async function runStartupPostgresHealth({
  enabled = false,
  connectionString = "",
  timeoutMs = 5000,
  createPool = createPostgresPool,
  healthCheck = postgresHealth,
  log = () => {},
} = {}) {
  if (!enabled) {
    return { enabled: false, configured: Boolean(connectionString), status: "disabled" };
  }

  if (!connectionString) {
    const result = {
      enabled: true,
      configured: false,
      status: "unconfigured",
      ok: false,
      error: "database_url_required",
    };
    log("postgres.startup_health", result);
    return result;
  }

  const pool = createPool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: Number(timeoutMs) || 5000,
  });

  try {
    const health = await healthCheck(pool);
    const result = {
      enabled: true,
      configured: true,
      status: "healthy",
      ok: true,
      databaseName: health.databaseName || null,
      serverVersion: health.serverVersion || null,
      latencyMs: Number(health.latencyMs || 0),
    };
    log("postgres.startup_health", result);
    return result;
  } catch (error) {
    const result = {
      enabled: true,
      configured: true,
      status: "failed",
      ok: false,
      error: String(error?.message || "postgres_health_failed").slice(0, 160),
    };
    log("postgres.startup_health", result);
    return result;
  } finally {
    await pool.end();
  }
}
