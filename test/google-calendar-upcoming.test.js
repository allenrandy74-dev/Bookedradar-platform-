import test from "node:test";
import assert from "node:assert/strict";
import { GoogleCalendarBookingAdapter } from "../src/integrations/google-calendar-booking.js";

const tuesday = {
  windowStart: "2026-11-24T09:10:00-06:00",
  windowEnd: "2026-11-24T13:10:00-06:00",
  durationMinutes: 60,
};

function calendarAt(t, instant, { returnedAt, busy = [] } = {}) {
  let clock = Date.parse(instant);
  t.mock.method(Date, "now", () => clock);
  const requests = [];
  const adapter = new GoogleCalendarBookingAdapter({
    clientId: "fixture",
    clientSecret: "fixture",
    refreshToken: "fixture",
    slotIncrementMinutes: 30,
    fetchImpl: async (url) => {
      requests.push(url);
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "fixture" });
      }
      assert.equal(url, "https://www.googleapis.com/calendar/v3/freeBusy");
      if (returnedAt) clock = Date.parse(returnedAt);
      return Response.json({ calendars: { primary: { busy } } });
    },
  });
  return { adapter, requests };
}

function assertNewWindow(result) {
  assert.deepEqual(result.slots, []);
  assert.equal(result.confirmed, false);
  assert.equal(result.needsWindowRange, true);
}

test("an elapsed window asks for a new time without contacting the provider", async t => {
  const { adapter, requests } = calendarAt(t, "2026-11-24T13:20:00-06:00");
  assertNewWindow(await adapter.findAvailability(tuesday));
  assert.deepEqual(requests, []);
});

test("a partly elapsed window keeps the original grid and skips busy time", async t => {
  const { adapter } = calendarAt(t, "2026-11-24T10:20:00-06:00", {
    busy: [{ start: "2026-11-24T10:40:00-06:00", end: "2026-11-24T11:10:00-06:00" }],
  });
  const result = await adapter.findAvailability(tuesday);
  assert.deepEqual(result.slots.map(slot => slot.start), [
    "2026-11-24T17:10:00.000Z", "2026-11-24T17:40:00.000Z", "2026-11-24T18:10:00.000Z",
  ]);
  assert.ok(result.slots.every(slot => Date.parse(slot.end) - Date.parse(slot.start) === 60 * 60000));
  assert.equal(result.confirmed, false);
});

test("a slot that passes while the calendar responds is removed before suggestions are returned", async t => {
  const { adapter } = calendarAt(t, "2026-11-24T09:09:59.999-06:00", {
    returnedAt: "2026-11-24T09:10:00.001-06:00",
  });
  const result = await adapter.findAvailability(tuesday);
  assert.equal(result.slots.length, 5);
  assert.equal(result.slots[0].start, "2026-11-24T15:40:00.000Z");
});

test("the last full slot can start now, then expires even when the window is still open", async t => {
  const { adapter, requests } = calendarAt(t, "2026-11-24T12:10:00-06:00", {
    returnedAt: "2026-11-24T12:10:00.001-06:00",
  });
  assertNewWindow(await adapter.findAvailability(tuesday));
  assert.equal(requests.length, 2);
  assertNewWindow(await adapter.findAvailability(tuesday));
  assert.equal(requests.length, 2);
});

test("a slot starting exactly now is still available for its full duration", async t => {
  const { adapter } = calendarAt(t, "2026-11-24T12:10:00-06:00");
  const result = await adapter.findAvailability(tuesday);
  assert.deepEqual(result.slots.map(slot => [slot.start, slot.end]), [
    ["2026-11-24T18:10:00.000Z", "2026-11-24T19:10:00.000Z"],
  ]);
});
