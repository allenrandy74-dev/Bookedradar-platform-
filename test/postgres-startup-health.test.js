import test from "node:test";
import assert from "node:assert/strict";
import { runStartupPostgresHealth } from "../src/postgres-startup-health.js";

test("startup Postgres health is inert when disabled", async () => {
  let poolCreated = false;
  const result = await runStartupPostgresHealth({
    enabled: false,
    connectionString: "postgresql://secret",
    createPool() { poolCreated = true; throw new Error("should not run"); },
  });
  assert.deepEqual(result, {
    enabled: false,
    configured: true,
    status: "disabled",
  });
  assert.equal(poolCreated, false);
});

test("startup Postgres health reports unconfigured without attempting a connection", async () => {
  const logs = [];
  const result = await runStartupPostgresHealth({
    enabled: true,
    connectionString: "",
    log: (event, fields) => logs.push({ event, ...fields }),
    createPool() { throw new Error("should not run"); },
  });
  assert.equal(result.status, "unconfigured");
  assert.equal(result.ok, false);
  assert.equal(result.error, "database_url_required");
  assert.equal(logs[0].event, "postgres.startup_health");
});

test("startup Postgres health reports safe metadata and closes pool", async () => {
  const secret = "postgresql://user:secret-password@internal/db";
  let ended = false;
  const logs = [];
  const pool = { async end() { ended = true; } };
  const result = await runStartupPostgresHealth({
    enabled: true,
    connectionString: secret,
    timeoutMs: 4000,
    createPool(config) {
      assert.equal(config.connectionString, secret);
      assert.equal(config.max, 1);
      assert.equal(config.connectionTimeoutMillis, 4000);
      return pool;
    },
    async healthCheck(received) {
      assert.equal(received, pool);
      return {
        databaseName: "bookedradar_postgres_production",
        serverVersion: "18.0",
        latencyMs: 9,
      };
    },
    log: (event, fields) => logs.push({ event, ...fields }),
  });
  assert.equal(ended, true);
  assert.equal(result.status, "healthy");
  assert.equal(result.ok, true);
  assert.equal(JSON.stringify(result).includes("secret-password"), false);
  assert.equal(JSON.stringify(logs).includes("secret-password"), false);
});

test("startup Postgres health records failure and still closes pool", async () => {
  let ended = false;
  const pool = { async end() { ended = true; } };
  const result = await runStartupPostgresHealth({
    enabled: true,
    connectionString: "postgresql://user:hidden@internal/db",
    createPool() { return pool; },
    async healthCheck() { throw new Error("connection_refused"); },
  });
  assert.equal(ended, true);
  assert.equal(result.status, "failed");
  assert.equal(result.ok, false);
  assert.equal(result.error, "connection_refused");
  assert.equal(JSON.stringify(result).includes("hidden"), false);
});
