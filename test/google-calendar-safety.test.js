import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleCalendarBookingAdapter } from '../src/integrations/google-calendar-booking.js';
const slot = { slotStart: '2026-11-02T15:00:00Z', slotEnd: '2026-11-02T16:00:00Z' };
function fixture({ busy = [], freeBusy } = {}) {
  let writes = 0, reads = 0;
  const adapter = new GoogleCalendarBookingAdapter({clientId:'synthetic',clientSecret:'synthetic',refreshToken:'synthetic',fetchImpl:async (url) => {
    if (url.includes('oauth2.googleapis.com')) return Response.json({access_token:'synthetic'});
    if (url.endsWith('/freeBusy')) { reads++; return freeBusy ? freeBusy(reads) : Response.json({calendars:{primary:{busy}}}); }
    writes++;
    throw new Error('No provider writes permitted');
  }});
  return { adapter, writes:()=>writes };
}
// Keep validation regression coverage on the still-supported availability path.
for (const busy of [null, {}, [{start:slot.slotStart,end:slot.slotStart}], [{start:slot.slotEnd,end:slot.slotStart}], [null]]) {
  test(`invalid busy intervals cannot provide availability: ${JSON.stringify(busy)}`, async () => {
    const f=fixture({busy});
    await assert.rejects(f.adapter.findAvailability({windowStart:slot.slotStart,windowEnd:slot.slotEnd}), /availability_unknown/);
    assert.equal(f.writes(),0);
    assert.equal((await f.adapter.createBooking(slot)).confirmed,false);
  });
}
test('availability error can be retried without enabling booking',async()=>{
  const f=fixture({freeBusy:n=>Response.json(n===1?{}:{calendars:{primary:{busy:[]}}})});
  const window={windowStart:slot.slotStart,windowEnd:slot.slotEnd};
  await assert.rejects(f.adapter.findAvailability(window),/availability_unknown/);
  const result=await f.adapter.findAvailability(window);
  assert.equal(result.slots.length,1);
  assert.equal(result.confirmed,false);
  assert.match(result.message,/not reserved/);
  assert.equal((await f.adapter.createBooking(slot)).confirmed,false);
  assert.equal(f.writes(),0);
});
for (const start of ['2026-02-30T15:00:00Z','2026-11-02T24:00:00Z','2026-11-02T15:00:00']) {
  test(`ambiguous or normalized calendar date rejected: ${start}`,async()=>{
    const f=fixture();
    await assert.rejects(f.adapter.createBooking({...slot,slotStart:start}),/invalid_booking_slot/);
    assert.equal(f.writes(),0);
  });
}
for (const key of ['bufferBeforeMinutes','bufferAfterMinutes','buffer_before_minutes','buffer_after_minutes']) {
  test(`unsupported buffer still rejected: ${key}`,async()=>{
    const f=fixture();
    await assert.rejects(f.adapter.createBooking({...slot,[key]:15}),/unsupported_booking_buffer/);
    assert.equal(f.writes(),0);
  });
}
