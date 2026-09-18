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
