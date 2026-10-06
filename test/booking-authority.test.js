import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleCalendarBookingAdapter } from '../src/integrations/google-calendar-booking.js';
import { bookingAdapterForTenant } from '../src/integrations/tenant-adapters.js';
const slot={slotStart:'2026-11-02T15:00:00Z',slotEnd:'2026-11-02T16:00:00Z',callId:'same-intent'};
const tenant={tenantId:'a',policies:{bookingMode:'live_booking'},integrations:{calendar:{enabled:true,type:'google_calendar',clientId:'synthetic',clientSecret:'synthetic',refreshToken:'synthetic',calendarId:'shared@example.test'}}};
function denied(result){assert.equal(result.confirmed,false);assert.equal(result.bookingId,null);assert.equal(result.reason,'booking_authority_unavailable');assert.equal(result.needsHumanReview,true);}
test('cross-tenant, reloaded instances, overlapping and repeated intents never insert',async()=>{
  let operations=0;
  const cases=[tenant,{...tenant,tenantId:'b'},JSON.parse(JSON.stringify(tenant)),{...tenant,integrations:{calendar:{...tenant.integrations.calendar,refreshToken:'rotated',calendarId:'primary'}}}];
  const adapters=cases.map(t=>bookingAdapterForTenant(t,{env:{}}));
  for(const adapter of adapters) adapter.fetchImpl=async()=>{operations++;throw new Error('no network');};
  const results=await Promise.all(adapters.flatMap((a,i)=>[a.createBooking(slot),a.createBooking({...slot,slotStart:i%2?'2026-11-02T15:30:00Z':slot.slotStart})]));
  results.forEach(denied);
  assert.equal(operations,0);
  assert.ok(adapters.every(a=>a.supportsLiveBooking===false));
});
test('fake local authority and legacy attempt maps cannot enable provider writes',async()=>{
  let operations=0;
  const a=new GoogleCalendarBookingAdapter({reservationAttempts:new Map(),bookingAuthority:{durable:true,reserve:()=>true},fetchImpl:async()=>{operations++;throw new Error('no network');}});
  denied(await a.createBooking(slot));
  assert.equal(operations,0);
});
test('previous uncertain outcomes cannot cause a blind retry under any receipt shape',async()=>{
  for(const response of [null,{id:'event'},{id:'event',status:'cancelled'},{id:123}]) {
    let operations=0;
    const a=new GoogleCalendarBookingAdapter({fetchImpl:async()=>{operations++;return Response.json(response);}});
    denied(await a.createBooking({...slot,previousOutcome:'unknown'}));
    denied(await a.createBooking({...slot,previousOutcome:'unknown'}));
    assert.equal(operations,0);
  }
});
