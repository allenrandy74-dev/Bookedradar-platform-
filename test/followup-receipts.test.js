import test from 'node:test';
import assert from 'node:assert/strict';
import { ResendEmailAdapter } from '../src/integrations/resend-email.js';
import { TwilioSmsAdapter } from '../src/integrations/twilio-sms.js';
import { EmailWebhookAdapter } from '../src/integrations/email-webhook.js';
const context={contact:{email:'synthetic@example.invalid',phone:'+15555550100'},content:'Synthetic',tenant:{tenantId:'t1',businessName:'Synthetic'},action:{id:'synthetic',opportunityId:'o',template:'synthetic'}};
const adapters={resend:()=>new ResendEmailAdapter({apiKey:'synthetic',from:'synthetic@example.invalid'}),twilio:()=>new TwilioSmsAdapter({accountSid:'synthetic',authToken:'synthetic',fromNumber:'+15555550101'}),email_webhook:()=>new EmailWebhookAdapter({url:'https://example.invalid'})};
const sid='SM'+'1'.repeat(32);
for(const [name,make] of Object.entries(adapters)) {
  test(`${name} rejects a successful HTTP response without a verified receipt`,async t=>{
    for(const body of ['', '{}', 'null', '{"id":7,"sid":7}', '{"id":" ","sid":" "}', '{"id":{},"sid":{}}', 'not-json']) {
      let calls=0; const mock=t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(body,{status:200});});
      await assert.rejects(make().send(context),e=>e.reconciliationRequired===true && /acceptance_unverified/.test(e.message));
      assert.equal(calls,1);mock.mock.restore();
    }
  });
}
test('Twilio rejects failed, inbound, missing and unknown statuses with a valid SID',async t=>{
  for(const status of ['failed','undelivered','canceled','receiving','received','unknown',null]) {
    const mock=t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({sid,status}),{status:200}));
    await assert.rejects(adapters.twilio().send(context),e=>e.reconciliationRequired===true);mock.mock.restore();
  }
});
test('valid provider receipts preserve acceptance without claiming delivery',async t=>{
  for(const [name,body] of [['resend',{id:' receipt '}],['twilio',{sid,status:'queued'}],['email_webhook',{id:' receipt ',accepted:true}]]) {
    const mock=t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify(body),{status:200}));
    const result=await adapters[name]().send(context); assert.equal(result.accepted,true);assert.equal(result.delivered,undefined);
    assert.equal(result.id || result.sid,name==='twilio'?sid:'receipt');mock.mock.restore();
  }
});
test('custom email webhook requires explicit acceptance as well as receipt',async t=>{
  for(const accepted of [undefined,false,'true',1]) {
    const mock=t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({id:'receipt',accepted}),{status:200}));
    await assert.rejects(adapters.email_webhook().send(context),e=>e.reconciliationRequired===true);mock.mock.restore();
  }
});
