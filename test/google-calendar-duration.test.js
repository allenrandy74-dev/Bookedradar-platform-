import test from "node:test";
import assert from "node:assert/strict";
import { bookingAdapterForTenant } from "../src/integrations/tenant-adapters.js";

const window = {
  windowStart: "2030-06-10T14:00:00Z",
  windowEnd: "2030-06-10T22:00:00Z",
};

test.beforeEach(t => t.mock.method(Date, "now", () => Date.parse("2030-06-10T13:00:00Z")));

function configuredCalendar(defaultDurationMinutes) {
  const calendarId = "fixture-calendar";
  const adapter = bookingAdapterForTenant({
    policies: { bookingMode: "live_booking" },
    integrations: {
      calendar: {
        enabled: true,
        type: "google_calendar",
        calendarId,
        clientId: "fixture",
        clientSecret: "fixture",
        refreshToken: "fixture",
        defaultDurationMinutes,
      },
    },
  }, { env: {} });

  const requests = [];
  adapter.fetchImpl = async (url, options) => {
    requests.push(url);
    assert.equal(options.method, "POST");
    if (url === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "fixture" });
    }
    assert.equal(url, "https://www.googleapis.com/calendar/v3/freeBusy");
    return Response.json({ calendars: { [calendarId]: { busy: [] } } });
  };
  return { adapter, requests };
}

test("an explicit unsupported duration never produces a shorter slot", async () => {
  const { adapter, requests } = configuredCalendar(60);
  for (const duration_minutes of [540, 481, 14, 0, -1, 30.5, "invalid", [60]]) {
    const result = await adapter.findAvailability({ ...window, duration_minutes });
    assert.equal(result.reason, "unsupported_service_duration");
    assert.equal(result.needsHumanReview, true);
    assert.equal(result.confirmed, false);
    assert.deepEqual(result.slots, []);
  }
  assert.equal(requests.length, 0);
});

test("an invalid tenant default requires review unless the caller provides a valid duration", async () => {
  for (const defaultDuration of [540, 0, "invalid"]) {
    const { adapter, requests } = configuredCalendar(defaultDuration);
    const result = await adapter.findAvailability(window);
    assert.equal(result.reason, "unsupported_service_duration");
    assert.deepEqual(result.slots, []);
    assert.equal(requests.length, 0);
    const explicit = await adapter.findAvailability({ ...window, durationMinutes: 90 });
    assert.equal(explicit.slots[0].durationMinutes, 90);
  }
});

test("missing durations use the configured default and supported requests keep the exact duration", async () => {
  for (const [defaultDuration, request, expected] of [
    [undefined, {}, 60],
    ["90", { durationMinutes: null }, 90],
    [60, { durationMinutes: 15 }, 15],
    [60, { duration_minutes: "480" }, 480],
  ]) {
    const { adapter } = configuredCalendar(defaultDuration);
    const result = await adapter.findAvailability({ ...window, ...request });
    assert.equal(result.confirmed, false);
    assert.ok(result.slots.length > 0);
    for (const slot of result.slots) {
      assert.equal(slot.durationMinutes, expected);
      assert.equal(Date.parse(slot.end) - Date.parse(slot.start), expected * 60_000);
    }
  }
});
