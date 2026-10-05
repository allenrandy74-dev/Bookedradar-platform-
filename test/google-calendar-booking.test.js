import test from "node:test";
import assert from "node:assert/strict";
import { GoogleCalendarBookingAdapter } from "../src/integrations/google-calendar-booking.js";

function adapter(fetchImpl) {
  return new GoogleCalendarBookingAdapter({
    clientId:"client", clientSecret:"secret", refreshToken:"refresh", calendarId:"primary",
    timeZone:"America/Chicago", defaultDurationMinutes:60, slotIncrementMinutes:30, fetchImpl,
  });
}

test("Google Calendar adapter refreshes token and returns open slots", async () => {
  const calls=[];
  const a=adapter(async (url,options)=>{
    calls.push({url,options});
    if(url.includes("oauth2.googleapis.com")) return Response.json({access_token:"token",expires_in:3600});
    if(url.endsWith("/freeBusy")) return Response.json({calendars:{primary:{busy:[{start:"2026-09-25T15:00:00.000Z",end:"2026-09-25T16:00:00.000Z"}]}}});
    throw new Error("unexpected");
  });
  const result=await a.findAvailability({windowStart:"2026-09-25T14:00:00Z",windowEnd:"2026-09-25T18:00:00Z",durationMinutes:60});
  assert.equal(result.calendarProvider,"google");
  assert.ok(result.slots.length>0);
  assert.equal(result.slots.some(s=>s.start==="2026-09-25T15:00:00.000Z"),false);
  assert.equal(calls.filter(x=>x.url.includes("oauth2.googleapis.com")).length,1);
});

test("Google Calendar booking refuses unsupported authority before any provider operation", async () => {
  let calls=0;
  const a=adapter(async()=>{calls++; throw new Error("must not contact provider");});
  const result=await a.createBooking({tenantId:"demo",callId:"call",name:"Alex Smith",slot:"2026-09-25T14:00:00Z|2026-09-25T15:00:00Z"});
  assert.equal(result.confirmed,false);
  assert.equal(result.bookingId,null);
  assert.equal(result.reason,"booking_authority_unavailable");
  assert.equal(result.needsHumanReview,true);
  assert.equal(calls,0);
});

test("Google Calendar does not offer or book slots when free/busy evidence is incomplete", async t => {
  const invalidCalendars = [
    ["missing calendar", {}],
    ["calendar error", { primary: { errors: [{ reason: "notFound" }] } }],
    ["error with empty busy list", { primary: { errors: [{ reason: "internalError" }], busy: [] } }],
    ["missing busy list", { primary: {} }],
    ["invalid busy list", { primary: { busy: {} } }],
    ["invalid interval", { primary: { busy: [{ start: "invalid", end: "invalid" }] } }],
    ["reversed interval", { primary: { busy: [{ start: "2026-09-25T15:00:00Z", end: "2026-09-25T14:00:00Z" }] } }],
    ["null interval", { primary: { busy: [null] } }],
  ];
  for (const [name, calendars] of invalidCalendars) {
    await t.test(name, async () => {
      let inserts = 0;
      const a = adapter(async url => {
        if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "token", expires_in: 3600 });
        if (url.endsWith("/freeBusy")) return Response.json({ calendars });
        inserts++;
        return Response.json({ id: "must-not-be-created" });
      });
      await assert.rejects(a.findAvailability({ windowStart: "2026-09-25T14:00:00Z", windowEnd: "2026-09-25T15:00:00Z" }), /google_calendar_availability_unknown/);
      assert.equal((await a.createBooking({ slot: "2026-09-25T14:00:00Z|2026-09-25T15:00:00Z" })).reason, "booking_authority_unavailable");
      assert.equal(inserts, 0);
    });
  }
});
