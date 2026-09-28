import { pathToFileURL } from "node:url";
import path from "node:path";
import { createPostgresPool, postgresHealth } from "../src/postgres-runtime.js";

export async function runPostgresHealthProbe(env = process.env) {
  const databaseUrl = String(env.DATABASE_URL || "").trim();
  if (!databaseUrl) {
    return {
      ok: false,
      configured: false,
      error: "database_url_required",
    };
  }

  const pool = createPostgresPool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: Number(env.POSTGRES_HEALTH_TIMEOUT_MS || 5000),
  });

  try {
    const health = await postgresHealth(pool);
    return {
      ok: true,
      configured: true,
      databaseName: health.databaseName,
      serverVersion: health.serverVersion,
      latencyMs: health.latencyMs,
    };
  } finally {
    await pool.end();
  }
}

export async function main(env = process.env) {
  const result = await runPostgresHealthProbe(env);
  console.log(JSON.stringify({ event: "postgres.health", ...result }));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(JSON.stringify({
      event: "postgres.health",
      ok: false,
      configured: Boolean(process.env.DATABASE_URL),
      error: String(error?.message || "postgres_health_failed").slice(0, 160),
    }));
    process.exitCode = 1;
  });
}
