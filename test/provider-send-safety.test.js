import test from 'node:test';
import assert from 'node:assert/strict';
import {WixHumanTaskAdapter} from '../src/integrations/wix-human-task.js';
import {TwilioSmsAdapter} from '../src/integrations/twilio-sms.js';
import {EmailWebhookAdapter} from '../src/integrations/email-webhook.js';
import {ResendEmailAdapter} from '../src/integrations/resend-email.js';
test('fenced Wix dispatch does not internally retry an ambiguous provider failure',async t=>{
  let calls=0;
  t.mock.method(globalThis,'fetch',async(_url,options)=>{calls++;assert.ok(options.signal instanceof AbortSignal);return new Response('{"message":"synthetic failure"}',{status:503});});
  const adapter=new WixHumanTaskAdapter({apiKey:'synthetic',siteId:'synthetic',retries:3});
  await assert.rejects(adapter.send({action:{template:'test'},contact:{phone:'+14095550111'},opportunity:{},deliveryPolicy:'single_attempt'}),/503/);
  assert.equal(calls,1);
});
test('SMS and email providers receive bounded abort signals with no send loop',async t=>{
  let calls=0;
  t.mock.method(globalThis,'fetch',async(_url,options)=>{calls++;assert.ok(options.signal instanceof AbortSignal);return new Response('{"sid":"synthetic","id":"synthetic"}',{status:200});});
  const context={contact:{phone:'+14095550111',email:'synthetic@example.invalid'},content:'Synthetic',tenant:{tenantId:'t1',businessName:'Synthetic'},action:{id:'a',opportunityId:'o'}};
  await new TwilioSmsAdapter({accountSid:'synthetic',authToken:'synthetic',fromNumber:'+14095550112'}).send(context);
  await new EmailWebhookAdapter({url:'https://example.invalid'}).send(context);
  await new ResendEmailAdapter({apiKey:'synthetic',from:'test@example.invalid'}).send(context);
  assert.equal(calls,3);
});
