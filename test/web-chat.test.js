import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WebChatStore, allowedWebChatOrigin, runWebChatTurn, webChatEnabled, webChatInstructions } from "../src/web-chat.js";

test("web chat requires explicit feature and integration plus allowlisted origin", () => {
  const tenant={features:{webChat:true},integrations:{webChat:{enabled:true,allowedOrigins:["https://example.com"]}}};
  assert.equal(webChatEnabled(tenant),true);
  assert.equal(allowedWebChatOrigin(tenant,"https://example.com"),true);
  assert.equal(allowedWebChatOrigin(tenant,"https://evil.example"),false);
});

test("web chat store isolates sessions by tenant", async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"br-web-chat-"));
  const store=new WebChatStore(path.join(dir,"chat.json"));
  const a=await store.getOrCreate("a");
  const b=await store.getOrCreate("b",a.id);
  assert.notEqual(a.id,b.id);
});

test("web chat prompt keeps confirm-only and no-price guardrails", () => {
  const text=webChatInstructions({businessName:"Acme",policies:{bookingMode:"confirm_only",quotePrices:false}});
  assert.match(text,/team will confirm/i);
  assert.match(text,/Do not quote/i);
});

test("web chat structured turn merges known lead fields", async () => {
  const response={
    reply:"What city is the service address in?",
    fields:{name:"Alex",phone:"+14095550100",email:"",service_type:"AC repair",service_address:"123 Oak",city:"",urgency:"urgent",preferred_window:"today"},
    needs_human:false,lead_ready:true,
  };
  const client={responses:{create:async()=>({output_text:JSON.stringify(response)})}};
  const result=await runWebChatTurn({client,tenant:{businessName:"Acme"},session:{fields:{name:"Alex"},messages:[]},message:"AC is out"});
  assert.equal(result.fields.name,"Alex");
  assert.equal(result.fields.service_type,"AC repair");
  assert.equal(result.leadReady,true);
});

test("web chat structured turn preserves human-request intent with captured lead fields", async () => {
  const response={
    reply:"I’ll have someone follow up with you.",
    fields:{name:"QA Visitor",phone:"",email:"qa@example.com",service_type:"AC repair",service_address:"",city:"",urgency:"routine",preferred_window:""},
    needs_human:true,lead_ready:true,
  };
  const client={responses:{create:async()=>({output_text:JSON.stringify(response)})}};
  const result=await runWebChatTurn({
    client,
    tenant:{businessName:"Acme",policies:{bookingMode:"confirm_only",quotePrices:false}},
    session:{fields:{},messages:[]},
    message:"I need AC repair and want to speak with a person. My email is qa@example.com."
  });
  assert.equal(result.needsHuman,true);
  assert.equal(result.leadReady,true);
  assert.equal(result.fields.email,"qa@example.com");
  assert.equal(result.fields.service_type,"AC repair");
  assert.match(result.reply,/follow up/i);
});
