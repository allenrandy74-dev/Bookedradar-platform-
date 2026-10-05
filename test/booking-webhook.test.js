import test from 'node:test';
import assert from 'node:assert/strict';
import { BookingWebhookAdapter } from '../src/integrations/booking-webhook.js';

test('booking webhook refuses unsupported writes including direct action requests',async(t)=>{
  let writes=0;
  t.mock.method(globalThis,'fetch',async()=>{writes++;throw new Error('must not run');});
  const a=new BookingWebhookAdapter({url:'https://example.test/book'});
  for(const response of [await a.createBooking({slot:'tomorrow'}),await a.request('create_booking',{})]) {
    assert.equal(response.confirmed,false);
    assert.equal(response.bookingId,null);
    assert.equal(response.reason,'booking_authority_unavailable');
  }
  assert.equal(writes,0);
});
test('webhook availability action is fixed and never represented as confirmed',async(t)=>{
  const calls=[];
  t.mock.method(globalThis,'fetch',async(_url,options)=>{
    calls.push(JSON.parse(options.body));
    return Response.json({confirmed:true,bookingId:'untrusted',message:'Booked',slots:[]});
  });
  const a=new BookingWebhookAdapter({url:'https://example.test/book'});
  const result=await a.findAvailability({action:'create_booking'});
  await a.request('find_availability',{action:'create_booking',request:{}});
  assert.equal(calls.length,2);
  assert.ok(calls.every(x=>x.action==='find_availability'));
  assert.equal(result.confirmed,false);
  assert.equal(result.bookingId,null);
  assert.match(result.message,/advisory/);
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
        assert.equal(result.reason, "booking_authority_unavailable");
      });
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("booking webhook ignores offered receipts and declines without calling provider", async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ confirmed: true, bookingId: 'b1' }); });
  const result = await new BookingWebhookAdapter({ url: 'https://example.test/book' }).createBooking({});
  assert.equal(result.reason, 'booking_authority_unavailable');
  assert.equal(result.confirmed, false);
  assert.equal(calls, 0);
});
