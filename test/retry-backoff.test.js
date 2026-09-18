import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RecoveryStore } from "../src/recovery/store.js";
import { ActionDispatcher } from "../src/integrations/dispatcher.js";

test("failed dispatch is rescheduled with backoff before final failure", async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"br-backoff-"));
  const store=new RecoveryStore(path.join(dir,"state.json"));
  const dueAt=new Date(Date.now()-1000).toISOString();
  await store.createOpportunity({id:"o1",tenantId:"t1",contactKey:"t1:c",type:"missed_call"});
  await store.upsertContact("t1:c",{phone:"+14095550111",transactionalSmsAllowed:true});
  await store.scheduleAction({tenantId:"t1",opportunityId:"o1",contactKey:"t1:c",channel:"sms",template:"missed_call_ack",purpose:"transactional",dueAt});
  const tenant={tenantId:"t1",businessName:"T1",timeZone:"America/Chicago",policies:{maxDispatchAttempts:3,retryBaseMinutes:.01,sms:{allowTransactionalWhenInbound:true}}};
  const dispatcher=new ActionDispatcher({store,tenant,adapters:{sms:{send:async()=>{throw new Error("provider down")}}}});
  const first=await dispatcher.runOnce({limit:10});
  assert.equal(first[0].action.status,"pending");
  assert.equal(first[0].action.attempts,1);
  assert.ok(new Date(first[0].action.dueAt).getTime()>Date.now());
});
