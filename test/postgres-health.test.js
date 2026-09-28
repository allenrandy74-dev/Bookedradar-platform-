import test from "node:test";
import assert from "node:assert/strict";
import { runPostgresHealthProbe } from "../scripts/postgres-health.mjs";

test("Postgres health probe refuses missing DATABASE_URL", async () => {
  const result = await runPostgresHealthProbe({});
  assert.deepEqual(result, {
    ok: false,
    configured: false,
    error: "database_url_required",
  });
});

test("Postgres health probe returns only safe metadata and closes the pool", async () => {
  const secretUrl = "postgresql://user:super-secret-password@internal/db";
  let ended = false;
  let capturedConfig = null;
  const pool = {
    async end() { ended = true; },
  };

  const result = await runPostgresHealthProbe(
    { DATABASE_URL: secretUrl, POSTGRES_HEALTH_TIMEOUT_MS: "4000" },
    {
      createPool(config) {
        capturedConfig = config;
        return pool;
      },
      async healthCheck(receivedPool) {
        assert.equal(receivedPool, pool);
        return {
          ok: true,
          databaseName: "bookedradar_postgres_production",
          serverVersion: "18.0",
          latencyMs: 12,
        };
      },
    }
  );

  assert.equal(capturedConfig.connectionString, secretUrl);
  assert.equal(capturedConfig.max, 1);
  assert.equal(capturedConfig.connectionTimeoutMillis, 4000);
  assert.equal(ended, true);
  assert.deepEqual(result, {
    ok: true,
    configured: true,
    databaseName: "bookedradar_postgres_production",
    serverVersion: "18.0",
    latencyMs: 12,
  });
  assert.equal(JSON.stringify(result).includes("super-secret-password"), false);
});
