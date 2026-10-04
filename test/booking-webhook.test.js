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
