import test from "node:test";
import assert from "node:assert/strict";
import { createBookingOnce } from "../src/integrations/booking-once.js";

const request = { tenantId: "a", callId: "call-a", slot: "tomorrow 9am", name: "Test caller" };
function fixture(saved = { tenantId: "a" }) {
  const store = {
    tenantId: "a", saved: structuredClone(saved),
    async getCall() { return structuredClone(this.saved); },
    async claimBooking(_id, attempt) {
      if (!this.saved || this.saved.bookingAttempt) return null;
      this.saved.bookingAttempt = { ...attempt, status: "pending" };
      return structuredClone(this.saved.bookingAttempt);
    },
    async finishBooking(_id, attemptId, patch) {
      if (this.saved.bookingAttempt.attemptId !== attemptId || this.saved.bookingAttempt.status !== "pending") return null;
      Object.assign(this.saved.bookingAttempt, patch);
      return structuredClone(this.saved.bookingAttempt);
    },
  };
  let calls = 0;
  const adapter = { async createBooking() { calls++; return { confirmed: true, bookingId: "receipt-1" }; } };
  return { store, adapter, calls: () => calls };
}

test("concurrent duplicates and restarted workers cannot create another booking", async () => {
  const f = fixture();
  let release, entered;
  const enteredPromise = new Promise(resolve => { entered = resolve; });
  f.adapter.createBooking = () => { entered(); return new Promise(resolve => { release = resolve; }); };
  const first = createBookingOnce({ ...f, request });
  await enteredPromise;
  const pending = await Promise.all(Array.from({ length: 40 }, () => createBookingOnce({ ...f, request })));
  assert.ok(pending.every(r => !r.confirmed && r.reconciliationRequired));
  release({ confirmed: true, bookingId: "receipt-1" });
  assert.equal((await first).confirmed, true);
  const restarted = fixture(f.store.saved);
  const reordered = Object.fromEntries(Object.entries(request).reverse());
  const replay = await createBookingOnce({ ...restarted, request: reordered });
  assert.equal(replay.bookingId, "receipt-1");
  assert.equal(replay.duplicate, true);
  assert.equal(restarted.calls(), 0);
  const conflict = await createBookingOnce({ ...restarted, request: { ...request, slot: "different slot" } });
  assert.equal(conflict.reason, "booking_request_conflict");
  assert.equal(restarted.calls(), 0);
});

test("uncertain outcomes never retry after restart", async t => {
  for (const [name, result] of [["missing receipt", { confirmed: true }], ["pending provider", { confirmed: false, reason: "pending" }], ["malformed", null], ["timeout", "throw"]]) {
    await t.test(name, async () => {
      const f = fixture();
      f.adapter.createBooking = async () => { if (result === "throw") throw new Error("provider_secret_must_not_escape"); return result; };
      const outcome = await createBookingOnce({ ...f, request });
      assert.equal(outcome.confirmed, false);
      assert.equal(outcome.reconciliationRequired, true);
      assert.equal(f.store.saved.bookingAttempt.status, "uncertain");
      const restarted = fixture(f.store.saved);
      assert.equal((await createBookingOnce({ ...restarted, request })).reconciliationRequired, true);
      assert.equal(restarted.calls(), 0);
    });
  }
});

test("failed receipt persistence retains the pending claim and blocks replay", async () => {
  const f = fixture();
  f.store.finishBooking = async () => { throw new Error("database_unavailable"); };
  assert.equal((await createBookingOnce({ ...f, request })).reconciliationRequired, true);
  assert.equal(f.calls(), 1);
  assert.equal(f.store.saved.bookingAttempt.status, "pending");
  assert.equal((await createBookingOnce({ ...f, request })).reconciliationRequired, true);
  assert.equal(f.calls(), 1);
});

test("missing storage, ownership and claim failure prevent provider writes", async () => {
  const f = fixture();
  assert.equal((await createBookingOnce({ adapter: f.adapter, request })).reason, "durable_booking_store_required");
  assert.equal((await createBookingOnce({ ...f, request: { ...request, tenantId: "b" } })).reason, "booking_identity_required");
  const absent = fixture(null);
  assert.equal((await createBookingOnce({ ...absent, request })).reason, "booking_call_state_required");
  f.store.claimBooking = async () => { throw new Error("database_unavailable"); };
  await assert.rejects(createBookingOnce({ ...f, request }), /database_unavailable/);
  assert.equal(f.calls(), 0);
  assert.equal(absent.calls(), 0);
});

test("an explicit decline is saved and replayed without another write", async () => {
  const f = fixture();
  let calls = 0;
  f.adapter.createBooking = async () => { calls++; return { confirmed: false, reason: "slot_unavailable" }; };
  await createBookingOnce({ ...f, request });
  const replay = await createBookingOnce({ ...f, request });
  assert.equal(replay.confirmed, false);
  assert.equal(replay.duplicate, true);
  assert.equal(calls, 1);
});

test("an invalid stored confirmation cannot be replayed as a booking", async () => {
  const f = fixture();
  await createBookingOnce({ ...f, request });
  f.store.saved.bookingAttempt.result = { confirmed: true };
  assert.equal((await createBookingOnce({ ...f, request })).reconciliationRequired, true);
  assert.equal(f.calls(), 1);
});
