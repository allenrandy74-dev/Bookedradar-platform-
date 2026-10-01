import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { RecoveryStore } from "../src/recovery/store.js";
import { RecoveryEngine } from "../src/recovery/engine.js";
import { ActionDispatcher, voiceContactResolver } from "../src/integrations/dispatcher.js";

function tenant() {
  return {
    tenantId: "t1",
    businessName: "Test HVAC",
    trade: "HVAC",
    timeZone: "America/Chicago",
    serviceArea: ["X"],
    escalation: { humanPhone: "+14095550100" },
    policies: {
      bookingMode: "confirm_only",
      sms: { allowTransactionalWhenInbound: true },
    },
    economics: { defaultAverageJobValue: 500 },
  };
}

test("dispatcher executes one due action exactly once", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "br-dispatch-"));
  const store = new RecoveryStore(path.join(dir, "state.json"));
  const engine = new RecoveryEngine({ store, tenant: tenant() });

  const result = await engine.ingest({
    idempotencyKey: "miss-1",
    type: "missed_call",
    occurredAt: new Date(Date.now() - 60_000).toISOString(),
    contact: {
      phone: "+14095550111",
      transactionalSmsAllowed: true,
    },
  });

  let sends = 0;
  const dispatcher = new ActionDispatcher({
    store,
    tenant: tenant(),
    adapters: {
      sms: { send: async () => { sends += 1; return { sid: "x" }; } },
      human_task: { send: async () => ({ taskId: "t" }) },
    },
  });

  await dispatcher.runOnce({ now: new Date(), limit: 10 });
  await dispatcher.runOnce({ now: new Date(), limit: 10 });

  assert.equal(sends, 1);
});


test("blank intake names cannot erase an existing contact name", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "br-contact-"));
  const store = new RecoveryStore(path.join(dir, "state.json"));
  await store.upsertContact("t1:phone", { name: "Alex Smith", optedOut: true });
  const contact = await store.upsertContact("t1:phone", { name: "", firstName: undefined, optedOut: false });
  assert.equal(contact.name, "Alex Smith");
  assert.equal(contact.optedOut, false);
  await fs.rm(dir, { recursive: true, force: true });
});

test("human follow-up uses its own call identity despite a later call on the same number", async () => {
  const resolve = voiceContactResolver({ getCall: async id => ({ tenantId: "t1", lastLead: { name: id === "full" ? "Alex Smith" : "", callback_number: "+14095550111" } }) }, "t1");
  const context = { action: { channel: "human_task" }, contact: { name: "Someone Else", firstName: "Someone", lastName: "Else", optedOut: true }, opportunity: { tenantId: "t1", metadata: { callId: "full" } } };
  assert.equal((await resolve(context)).name, "Alex Smith");
  const unnamed = await resolve({ ...context, opportunity: { tenantId: "t1", metadata: { callId: "transfer-only" } } });
  assert.equal(unnamed.name, "");
  assert.equal(unnamed.firstName, "");
  assert.equal(unnamed.optedOut, true);
  assert.equal(await resolve({ ...context, action: { channel: "sms" } }), context.contact);
  await assert.rejects(resolve({ ...context, opportunity: { tenantId: "other", metadata: { callId: "full" } } }), /tenant mismatch/);
});

test('unverified provider acceptance stays held across legacy store restart with no second send',async t=>{
  const {ResendEmailAdapter}=await import('../src/integrations/resend-email.js');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'br-receipt-hold-'));
  const file=path.join(dir,'state.json');const store=new RecoveryStore(file);
  await store.upsertContact('t1:email',{email:'synthetic@example.invalid',marketingConsent:true});
  const opportunity=await store.createOpportunity({tenantId:'t1',type:'missed_call',contactKey:'t1:email'});
  const action=await store.scheduleAction({tenantId:'t1',opportunityId:opportunity.id,contactKey:'t1:email',channel:'email',purpose:'service',template:'estimate_followup',dueAt:new Date(Date.now()-60000).toISOString()});
  let sends=0;t.mock.method(globalThis,'fetch',async()=>{sends++;return new Response('{}',{status:200});});
  const adapters={email:new ResendEmailAdapter({apiKey:'synthetic',from:'synthetic@example.invalid'})};
  try {
    const result=await new ActionDispatcher({store,tenant:tenant(),adapters}).runOnce();
    assert.equal(result[0].reconciliationRequired,true);assert.equal(result[0].action.status,'reconciliation_required');
    const restarted=new RecoveryStore(file);
    assert.equal((await restarted.snapshot()).actions[action.id].status,'reconciliation_required');
    assert.deepEqual(await new ActionDispatcher({store:restarted,tenant:tenant(),adapters}).runOnce({now:new Date(Date.now()+86400000)}),[]);
    assert.equal(sends,1);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
