import test from "node:test";
import assert from "node:assert/strict";
import { PostgresCallStateStore, PostgresWebhookStore, exportPostgresCallState } from "../src/postgres-state-store.js";

test("call state rejects missing tenant and mismatched ownership before querying", async () => {
  const pool = { query() { throw new Error("unexpected_query"); } };
  assert.throws(() => new PostgresCallStateStore(pool, ""), /tenant_id_required/);
  const store = new PostgresCallStateStore(pool, "demo-a");
  await assert.rejects(store.patchCall("call-a", { tenantId: "demo-b" }), /call_tenant_conflict/);
  await assert.rejects(store.patchCall("call-a", []), /call_patch_required/);
  await assert.rejects(store.getCall(""), /call_id_required/);
});

test("database outages propagate without claiming persistence or deduplication success", async () => {
  const pool = { async query() { throw new Error("offline"); } };
  await assert.rejects(new PostgresCallStateStore(pool, "a").patchCall("c", {}), /offline/);
  await assert.rejects(new PostgresCallStateStore(pool, "a").getCall("c"), /offline/);
  await assert.rejects(new PostgresWebhookStore(pool).markWebhookOnce("w"), /offline/);
  await assert.rejects(new PostgresWebhookStore(pool).releaseWebhook("w"), /offline/);
});

test("rollback export requires an explicit writer freeze", async () => {
  await assert.rejects(exportPostgresCallState({}, "/tmp/unused"), /writers_must_be_quiesced/);
});

test("failed rollback snapshot aborts transaction and releases connection", async () => {
  const queries = [];
  let released = false;
  const client = {
    async query(sql) {
      queries.push(sql);
      if (sql.startsWith("SELECT")) throw new Error("snapshot_failed");
    },
    release() { released = true; },
  };
  await assert.rejects(exportPostgresCallState({ connect: async () => client }, "/tmp/unused", { writersQuiesced: true }), /snapshot_failed/);
  assert.ok(queries.includes("ROLLBACK"));
  assert.ok(!queries.includes("COMMIT"));
  assert.equal(released, true);
});
