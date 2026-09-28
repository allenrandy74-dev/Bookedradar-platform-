import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPostgresSchema,
  createPostgresPool,
  importMigrationManifest,
  postgresHealth,
  reconcileMigration,
} from "../src/postgres-runtime.js";

function emptyManifest() {
  return {
    snapshotFingerprint: "a".repeat(64),
    counts: {},
    rows: {
      webhookReceipts: [],
      callControlState: [],
      voiceCalls: [],
      callTurns: [],
      leads: [],
      contacts: [],
      opportunities: [],
      recoveryEvents: [],
      recoveryActions: [],
      attribution: [],
      webChatSessions: [],
      transferRecords: [],
      growthMetrics: [],
      billingState: [],
    },
  };
}

function fakeClient({ failOn = null } = {}) {
  const queries = [];
  let released = false;
  return {
    queries,
    get released() { return released; },
    async query(sql, values = []) {
      const text = String(sql);
      queries.push({ sql: text, values });
      if (failOn && text.includes(failOn)) throw new Error("synthetic_db_failure");
      if (text.includes("to_regclass")) {
        return {
          rows: [{
            voice_calls: "bookedradar.voice_calls",
            opportunities: "bookedradar.recovery_opportunities",
          }],
        };
      }
      return { rows: [] };
    },
    release() { released = true; },
  };
}

test("postgres pool refuses missing or non-postgres URLs", () => {
  assert.throws(() => createPostgresPool({}), /postgres_connection_string_required/);
  assert.throws(
    () => createPostgresPool({ connectionString: "https://example.com" }),
    /postgres_connection_string_required/
  );
});

test("schema application is transactional, verifies tables, unlocks and releases", async () => {
  const client = fakeClient();
  const pool = { async connect() { return client; } };
  const result = await applyPostgresSchema(pool, "CREATE SCHEMA IF NOT EXISTS bookedradar;");
  assert.equal(result.ok, true);
  assert.ok(client.queries.some(q => q.sql === "BEGIN"));
  assert.ok(client.queries.some(q => q.sql === "COMMIT"));
  assert.ok(client.queries.some(q => q.sql.includes("pg_advisory_lock")));
  assert.ok(client.queries.some(q => q.sql.includes("pg_advisory_unlock")));
  assert.equal(client.released, true);
});

test("schema application rolls back on failure before releasing connection", async () => {
  const client = fakeClient({ failOn: "CREATE TABLE broken" });
  const pool = { async connect() { return client; } };
  await assert.rejects(
    applyPostgresSchema(pool, "CREATE TABLE broken(id int);"),
    /synthetic_db_failure/
  );
  assert.ok(client.queries.some(q => q.sql === "ROLLBACK"));
  assert.ok(client.queries.some(q => q.sql.includes("pg_advisory_unlock")));
  assert.equal(client.released, true);
});

test("manifest import runs in one transaction and upserts every row family", async () => {
  const manifest = emptyManifest();
  const now = new Date().toISOString();
  manifest.rows.webhookReceipts.push({ webhookId: "wh1", receivedAt: now });
  manifest.rows.callControlState.push({ callId: "c1", tenantId: "demo-hvac", updatedAt: now, payload: {} });
  manifest.rows.voiceCalls.push({
    callId: "c1", tenantId: "demo-hvac", callerMasked: "***0101", dialedMasked: "***4186",
    startedAt: now, endedAt: now, updatedAt: now, transferred: false, spamEnded: false, payload: {},
  });
  manifest.rows.callTurns.push({ callId: "c1", sequenceNo: 0, speaker: "caller", itemId: "i1", occurredAt: now, textContent: "test" });
  manifest.rows.leads.push({ sourceKey: "lead1", tenantId: "demo-hvac", callId: "c1", capturedAt: now, payload: {} });
  manifest.rows.contacts.push({ contactKey: "demo-hvac:+14095550101", tenantId: "demo-hvac", updatedAt: now, payload: {} });
  manifest.rows.opportunities.push({ opportunityId: "o1", tenantId: "demo-hvac", contactKey: "demo-hvac:+14095550101", status: "open", createdAt: now, updatedAt: now, payload: {} });
  manifest.rows.recoveryEvents.push({ eventId: "e1", tenantId: "demo-hvac", idempotencyKey: "k1", opportunityId: "o1", contactKey: null, occurredAt: now, payload: {} });
  manifest.rows.recoveryActions.push({ actionId: "a1", tenantId: "demo-hvac", opportunityId: "o1", contactKey: null, channel: "human_task", status: "pending", dueAt: now, claimedBy: null, claimedAt: null, claimExpiresAt: null, createdAt: now, completedAt: null, payload: {} });
  manifest.rows.attribution.push({ opportunityId: "o1", tenantId: "demo-hvac", updatedAt: now, payload: {} });
  manifest.rows.webChatSessions.push({ sessionId: "s1", tenantId: "demo-hvac", opportunityId: "o1", createdAt: now, updatedAt: now, payload: {} });
  manifest.rows.transferRecords.push({ transferId: "t1", tenantId: "demo-hvac", callId: "c1", status: "requested", updatedAt: now, payload: {} });
  manifest.rows.growthMetrics.push({ metricKey: "m1", metricCount: 2, updatedAt: now, payload: {} });
  manifest.rows.billingState.push({ mode: "test", payload: { mode: "test" } });

  const client = fakeClient();
  const pool = { async connect() { return client; } };
  const result = await importMigrationManifest(pool, manifest, { migrationId: "mig1" });
  assert.equal(result.ok, true);
  assert.equal(result.migrationId, "mig1");
  assert.equal(result.counts.voiceCalls, 1);
  assert.equal(result.counts.billingState, 1);
  assert.equal(client.queries[0].sql, "BEGIN");
  assert.ok(client.queries.some(q => q.sql.includes("bookedradar.voice_calls")));
  assert.ok(client.queries.some(q => q.sql.includes("bookedradar.lead_captures")));
  assert.ok(client.queries.some(q => q.sql.includes("bookedradar.billing_state")));
  assert.equal(client.queries.at(-1).sql, "COMMIT");
  assert.equal(client.released, true);
});

test("manifest import rolls back atomically on write failure", async () => {
  const manifest = emptyManifest();
  manifest.rows.contacts.push({
    contactKey: "demo-hvac:+14095550101",
    tenantId: "demo-hvac",
    updatedAt: new Date().toISOString(),
    payload: {},
  });
  const client = fakeClient({ failOn: "bookedradar.recovery_contacts" });
  const pool = { async connect() { return client; } };
  await assert.rejects(importMigrationManifest(pool, manifest), /synthetic_db_failure/);
  assert.ok(client.queries.some(q => q.sql === "ROLLBACK"));
  assert.equal(client.released, true);
  assert.equal(client.queries.some(q => q.sql === "COMMIT"), false);
});

test("reconciliation compares every target table and reports mismatches", async () => {
  const manifest = emptyManifest();
  manifest.rows.voiceCalls.push({ callId: "c1" });
  manifest.rows.contacts.push({ contactKey: "x" });

  const tableCounts = {
    webhook_receipts: 0,
    call_control_state: 0,
    voice_calls: 1,
    call_turns: 0,
    lead_captures: 0,
    recovery_contacts: 0,
    recovery_opportunities: 0,
    recovery_events: 0,
    recovery_actions: 0,
    recovery_attribution: 0,
    web_chat_sessions: 0,
    transfer_records: 0,
    growth_metrics: 0,
    billing_state: 0,
  };
  const pool = {
    async query(sql) {
      const match = String(sql).match(/FROM bookedradar\.([a-z_]+)/);
      return { rows: [{ count: tableCounts[match?.[1]] ?? 0 }] };
    },
  };
  const result = await reconcileMigration(pool, manifest);
  assert.equal(result.ok, false);
  assert.deepEqual(result.mismatches, [{ key: "contacts", expected: 1, actual: 0 }]);
});

test("postgres health returns database identity without credentials", async () => {
  const pool = {
    async query() {
      return { rows: [{ database_name: "bookedradar", server_version: "18.0" }] };
    },
  };
  const health = await postgresHealth(pool);
  assert.equal(health.ok, true);
  assert.equal(health.databaseName, "bookedradar");
  assert.equal(health.serverVersion, "18.0");
  assert.ok(Number.isFinite(health.latencyMs));
});
