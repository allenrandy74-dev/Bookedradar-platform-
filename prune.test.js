import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RecoveryStore } from "../src/recovery/store.js";

test("retention pruning removes only old terminal events/actions", async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"br-prune-"));
  const store=new RecoveryStore(path.join(dir,"state.json"));
  const old=new Date(Date.now()-200*24*60*60*1000).toISOString();
  await store.addEvent({idempotencyKey:"old",type:"x",occurredAt:old});
  const a=await store.scheduleAction({tenantId:"t1",opportunityId:"o",contactKey:"t1:c",channel:"human_task",template:"x",purpose:"service",dueAt:old,status:"completed",completedAt:old});
  await store.scheduleAction({tenantId:"t1",opportunityId:"o",contactKey:"t1:c",channel:"human_task",template:"y",purpose:"service",dueAt:new Date().toISOString(),status:"pending"});
  const result=await store.prune({eventRetentionDays:90,actionRetentionDays:180});
  assert.equal(result.deletedEvents,1);
  assert.equal(result.deletedActions,1);
  const snap=await store.snapshot();
  assert.equal(Object.values(snap.actions).filter(x=>x.status==="pending").length,1);
});
