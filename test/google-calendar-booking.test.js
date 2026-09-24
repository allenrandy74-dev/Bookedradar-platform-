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

test("Google Calendar booking rechecks availability before insert", async () => {
  let insertBody; let freeBusyCalls=0;
  const a=adapter(async (url,options)=>{
    if(url.includes("oauth2.googleapis.com")) return Response.json({access_token:"token",expires_in:3600});
    if(url.endsWith("/freeBusy")) { freeBusyCalls++; return Response.json({calendars:{primary:{busy:[]}}}); }
    if(url.includes("/events")) { insertBody=JSON.parse(options.body); return Response.json({id:"evt-1"}); }
    throw new Error("unexpected");
  });
  const result=await a.createBooking({
    tenantId:"demo",callId:"call",name:"Alex Smith",callbackNumber:"+14095550100",
    serviceType:"AC repair",serviceAddress:"123 Oak",city:"Silsbee",
    slot:"2026-09-25T14:00:00Z|2026-09-25T15:00:00Z"
  });
  assert.equal(result.confirmed,true);
  assert.equal(result.bookingId,"evt-1");
  assert.equal(freeBusyCalls,1);
  assert.match(insertBody.summary,/AC repair/);
  assert.match(insertBody.description,/BookedRadar call/);
});

test("Google Calendar booking refuses a slot that became busy", async () => {
  const a=adapter(async (url)=>{
    if(url.includes("oauth2.googleapis.com")) return Response.json({access_token:"token",expires_in:3600});
    if(url.endsWith("/freeBusy")) return Response.json({calendars:{primary:{busy:[{start:"2026-09-25T14:00:00.000Z",end:"2026-09-25T15:00:00.000Z"}]}}});
    throw new Error("event insert must not run");
  });
  const result=await a.createBooking({slot:"2026-09-25T14:00:00Z|2026-09-25T15:00:00Z"});
  assert.equal(result.confirmed,false);
  assert.equal(result.reason,"slot_no_longer_available");
});
