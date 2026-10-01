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

test("booking claims and completion reject invalid evidence before querying", async () => {
  const store = new PostgresCallStateStore({ query() { throw new Error("unexpected_query"); } }, "a");
  await assert.rejects(store.claimBooking("c", { attemptId: "attempt", requestHash: "bad" }), /booking_request_hash_required/);
  await assert.rejects(store.finishBooking("c", "attempt", { status: "confirmed", result: { confirmed: true } }), /booking_receipt_required/);
  await assert.rejects(store.finishBooking("c", "attempt", { status: "retry", result: {} }), /booking_status_invalid/);
});

test("booking review is read-only, tenant scoped and paginated without provider payloads", async () => {
  let queried;
  const rows=Array.from({length:51},(_,i)=>({callId:`call-${String(i).padStart(3,'0')}`,attemptId:`attempt-${i}`,status:'uncertain',updatedAt:'synthetic'}));
  const store=new PostgresCallStateStore({async query(sql,args){queried={sql,args};return {rows};}},'tenant-a');
  for (const cursor of [[],{},'x'.repeat(257)]) await assert.rejects(store.listBookingReview({afterCallId:cursor}),/booking_review_cursor_invalid/);
  assert.equal(queried,undefined);
  const page=await store.listBookingReview({afterCallId:'previous-call'});
  assert.deepEqual(queried.args,['tenant-a','previous-call']);
  assert.match(queried.sql,/^\s*SELECT/);
  assert.match(queried.sql,/tenant_id=\$1/);
  assert.match(queried.sql,/IN \('pending','uncertain'\)/);
  assert.match(queried.sql,/ORDER BY call_id ASC LIMIT 51/);
  assert.doesNotMatch(queried.sql,/SELECT payload|UPDATE|DELETE|INSERT/);
  assert.equal(page.attempts.length,50);
  assert.equal(page.nextAfterCallId,'call-049');
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
