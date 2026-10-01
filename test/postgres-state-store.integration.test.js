import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { PostgresCallStateStore, PostgresWebhookStore, exportPostgresCallState } from "../src/postgres-state-store.js";
import { JsonStateStore } from "../src/state-store.js";
import { createBookingOnce } from "../src/integrations/booking-once.js";

const connectionString = process.env.POSTGRES_TEST_URL;

test("real Postgres: concurrent state, tenant isolation, deduplication and JSON recovery", { skip: !connectionString }, async t => {
  const url = new URL(connectionString);
  // These tests remove their schema. Refuse any destination except the disposable local test DB.
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  assert.equal(url.pathname, "/bookedradar_test");
  const pool = new Pool({ connectionString, max: 10 });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "br-pg-state-"));
  try {
    await pool.query("DROP SCHEMA IF EXISTS bookedradar CASCADE");
    await pool.query(await fs.readFile(new URL("../db/postgres-schema.sql", import.meta.url), "utf8"));
    const a = new PostgresCallStateStore(pool, "tenant-a");
    const b = new PostgresCallStateStore(pool, "tenant-b");
    const webhooks = new PostgresWebhookStore(pool);

    await t.test("parallel patches retain every independent field", async () => {
      await Promise.all(Array.from({ length: 40 }, (_, i) => a.patchCall("shared", { [`field${i}`]: i })));
      const state = await a.getCall("shared");
      for (let i = 0; i < 40; i++) assert.equal(state[`field${i}`], i);
      assert.equal(state.tenantId, "tenant-a");
      assert.ok(Number.isSafeInteger(state.updatedAt));
    });
    await t.test("other tenants cannot read or replace the same call ID", async () => {
      assert.equal(await b.getCall("shared"), null);
      await assert.rejects(b.patchCall("shared", { stolen: true }), /call_tenant_conflict/);
      assert.equal((await a.getCall("shared")).stolen, undefined);
      await b.patchCall("other", { value: "b" });
      assert.equal(await a.getCall("other"), null);
    });
    await t.test("40 simultaneous webhook deliveries claim exactly once", async () => {
      const results = await Promise.all(Array.from({ length: 40 }, () => webhooks.markWebhookOnce("event-1")));
      assert.equal(results.filter(Boolean).length, 1);
      assert.equal(await webhooks.releaseWebhook("event-1"), true);
      assert.equal(await webhooks.releaseWebhook("event-1"), false);
      assert.equal(await webhooks.markWebhookOnce("event-1"), true);
    });
    await t.test("expired receipt can be reclaimed exactly once", async () => {
      await pool.query("UPDATE bookedradar.webhook_receipts SET received_at=now()-interval '25 hours' WHERE webhook_id='event-1'");
      const results = await Promise.all(Array.from({ length: 20 }, () => webhooks.markWebhookOnce("event-1")));
      assert.equal(results.filter(Boolean).length, 1);
    });
    await t.test("fresh store reads committed state and database rollback discards an update", async () => {
      assert.equal((await new PostgresCallStateStore(pool, "tenant-a").getCall("shared")).field39, 39);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await new PostgresCallStateStore(client, "tenant-a").patchCall("shared", { rolledBack: true });
        await client.query("ROLLBACK");
      } finally { client.release(); }
      assert.equal((await a.getCall("shared")).rolledBack, undefined);
    });
    await t.test("independent workers book once, preserve receipts and isolate tenants", async () => {
      let writes = 0;
      const request = { tenantId: "tenant-a", callId: "shared", slot: "synthetic-slot" };
      const adapter = { async createBooking() { writes++; return { confirmed: true, bookingId: "booking-1" }; } };
      await Promise.all(Array.from({ length: 40 }, () => createBookingOnce({
        store: new PostgresCallStateStore(pool, "tenant-a"), adapter, request,
      })));
      assert.equal(writes, 1);
      const replay = await createBookingOnce({ store: new PostgresCallStateStore(pool, "tenant-a"), adapter, request });
      assert.equal(replay.confirmed, true);
      assert.equal(replay.duplicate, true);
      assert.equal(writes, 1);
      assert.equal(await b.claimBooking("shared", { attemptId: "other", requestHash: "a".repeat(64) }), null);
      assert.equal(await a.finishBooking("shared", "wrong-owner", { status: "uncertain", result: { confirmed: false } }), null);
      assert.equal((await a.getCall("shared")).bookingAttempt.status, "confirmed");
      // Simulate process loss after a durable claim but before receipt persistence.
      await b.claimBooking("other", { attemptId: "interrupted", requestHash: "b".repeat(64) });
      assert.equal(await new PostgresCallStateStore(pool, "tenant-b").claimBooking("other", { attemptId: "restart", requestHash: "b".repeat(64) }), null);
    });
    await t.test("booking review includes only owned unresolved attempts without changing claims", async () => {
      assert.deepEqual(await a.listBookingReview(), { attempts: [], nextAfterCallId: null });
      const before = await b.getCall("other");
      const page = await b.listBookingReview();
      assert.equal(page.attempts.length, 1);
      assert.equal(page.attempts[0].callId, "other");
      assert.equal(page.attempts[0].status, "pending");
      assert.deepEqual(Object.keys(page.attempts[0]).sort(), ["attemptId", "callId", "status", "updatedAt"]);
      assert.deepEqual(await b.getCall("other"), before);
      assert.equal((await b.listBookingReview({ afterCallId: "other" })).attempts.length, 0);
      await b.patchCall("other", { bookingAttempt: { ...before.bookingAttempt, status: "uncertain" } });
      assert.equal((await b.listBookingReview()).attempts[0].status, "uncertain");
      assert.equal((await a.listBookingReview()).attempts.length, 0);
    });
    await t.test("export restores payloads and deduplication into existing JSON store", async () => {
      const report = await exportPostgresCallState(pool, root, { writersQuiesced: true });
      assert.equal(report.calls, 2);
      assert.equal(report.webhooks, 1);
      assert.equal((await fs.stat(report.file)).mode & 0o777, 0o600);
      const restored = new JsonStateStore(report.file);
      assert.deepEqual(await restored.getCall("shared"), await a.getCall("shared"));
      assert.deepEqual(await restored.getCall("other"), await b.getCall("other"));
      assert.equal(await restored.markWebhookOnce("event-1"), false);
      const another = await exportPostgresCallState(pool, root, { writersQuiesced: true });
      assert.notEqual(another.file, report.file);
    });
  } finally {
    await pool.query("DROP SCHEMA IF EXISTS bookedradar CASCADE");
    await pool.end();
    await fs.rm(root, { recursive: true, force: true });
  }
});
