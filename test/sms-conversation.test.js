import test from "node:test";
import assert from "node:assert/strict";
import { generateSmsReply, smsConversationEnabled, smsReplyInstructions } from "../src/sms-conversation.js";

test("two-way SMS requires both tenant feature and configured SMS channel", () => {
  assert.equal(smsConversationEnabled({ features:{twoWaySms:true}, integrations:{sms:{enabled:false}} }), false);
  assert.equal(smsConversationEnabled({ features:{twoWaySms:true}, integrations:{sms:{enabled:true}} }), true);
});

test("SMS prompt preserves confirm-only and pricing guardrails", () => {
  const text=smsReplyInstructions({
    tenant:{businessName:"Acme",services:["HVAC repair"],policies:{bookingMode:"confirm_only",quotePrices:false}},
    opportunity:{}
  });
  assert.match(text,/team will confirm/i);
  assert.match(text,/Do not quote/i);
  assert.match(text,/HVAC repair/);
});

test("SMS reply uses Responses API and returns bounded text", async () => {
  let request;
  const client={responses:{create:async body=>{request=body;return{output_text:"We received your update. The team will confirm the timing with you."};}}};
  const reply=await generateSmsReply({
    client,tenant:{businessName:"Acme",policies:{bookingMode:"confirm_only"}},
    opportunity:{serviceType:"AC repair",metadata:{preferredWindow:"tomorrow"}},
    contact:{name:"Alex"},customerText:"Can you come tomorrow?"
  });
  assert.match(reply,/team will confirm/i);
  assert.equal(request.model,"gpt-5.6-luna");
  assert.match(request.input,/Can you come tomorrow/);
});
