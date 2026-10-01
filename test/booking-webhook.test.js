import test from "node:test";
import assert from "node:assert/strict";
import { BookingWebhookAdapter } from "../src/integrations/booking-webhook.js";

test("booking webhook sends explicit action contract", async () => {
  const originalFetch = globalThis.fetch;
  let seen;
  globalThis.fetch = async (_url, options) => {
    seen = JSON.parse(options.body);
    return new Response(JSON.stringify({ confirmed: true, bookingId: "b1", slot: "tomorrow 9am" }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  };
  try {
    const adapter = new BookingWebhookAdapter({ url: "https://example.test/book", token: "x" });
    const result = await adapter.createBooking({ slot: "tomorrow 9am" });
    assert.equal(seen.action, "create_booking");
    assert.equal(result.confirmed, true);
    assert.equal(result.bookingId, "b1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("booking webhook refuses confirmation without an explicit valid receipt", async t => {
  const cases = [
    ["missing receipt", { confirmed: true }],
    ["blank receipt", { confirmed: true, bookingId: "   " }],
    ["numeric receipt", { confirmed: true, bookingId: 1 }],
    ["truthy confirmation", { confirmed: "true", bookingId: "b1" }],
    ["missing confirmation", { bookingId: "b1" }],
    ["null response", null],
    ["array response", []],
    ["primitive response", "confirmed"],
  ];
  const originalFetch = globalThis.fetch;
  try {
    for (const [name, payload] of cases) {
      await t.test(name, async () => {
        globalThis.fetch = async () => Response.json(payload);
        const adapter = new BookingWebhookAdapter({ url: "https://example.test/book" });
        const result = await adapter.createBooking({ slot: "tomorrow 9am" });
        assert.equal(result.confirmed, false);
        assert.equal(result.bookingId, null);
        assert.equal(result.reason, "booking_confirmation_unverified");
      });
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("booking webhook preserves an explicit decline and normalizes a valid receipt", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const adapter = new BookingWebhookAdapter({ url: "https://example.test/book" });
    globalThis.fetch = async () => Response.json({ confirmed: false, bookingId: "pending", reason: "slot_unavailable" });
    assert.deepEqual(await adapter.createBooking({}), { confirmed: false, bookingId: "pending", reason: "slot_unavailable" });
    globalThis.fetch = async () => Response.json({ confirmed: true, bookingId: " b1 ", slot: "tomorrow 9am" });
    assert.deepEqual(await adapter.createBooking({}), { confirmed: true, bookingId: "b1", slot: "tomorrow 9am" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
