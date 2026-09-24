import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RecoveryStore } from "../src/recovery/store.js";
import { RecoveryEngine } from "../src/recovery/engine.js";
import { ownerDailyBrief, opportunityTimeline, radarTrust, revenueLeakRadar } from "../src/growth-intelligence.js";

const tenant={tenantId:"t1",businessName:"Acme",timeZone:"America/Chicago",policies:{bookingMode:"confirm_only",quotePrices:false,recordCalls:false,transcriptRetentionApproved:true,sms:{allowTransactionalWhenInbound:true}},commercial:{schedulingApproved:false},features:{callerMemory:true,spamScreening:true},integrations:{sms:{enabled:false},webChat:{enabled:true},calendar:{enabled:false}},economics:{defaultAverageJobValue:500}};

async function fixture(){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"br-growth-"));
  const store=new RecoveryStore(path.join(dir,"state.json"));await store.load();
  return {store,engine:new RecoveryEngine({store,tenant})};
}

test("Revenue Leak Radar flags stale open value but not closed opportunities", async()=>{
  const {store,engine}=await fixture();
  const now=new Date("2026-09-24T18:00:00Z");
  const a=await engine.ingest({idempotencyKey:"a",occurredAt:"2026-09-24T10:00:00Z",type:"missed_call",contact:{phone:"+14095550100",transactionalSmsAllowed:true}});
  await store.patchOpportunity(a.opportunity.id,{updatedAt:"2026-09-24T10:00:00Z"});
  const report=await revenueLeakRadar(store,"t1",{now});
  assert.equal(report.leakCount,1);
  assert.equal(report.estimatedValueAtRisk,500);
  await engine.ingest({idempotencyKey:"close",occurredAt:"2026-09-24T12:00:00Z",type:"opportunity_lost",opportunityId:a.opportunity.id});
  assert.equal((await revenueLeakRadar(store,"t1",{now})).leakCount,0);
});

test("Owner Daily Brief combines activity and attention items", async()=>{
  const {store,engine}=await fixture();
  await engine.ingest({idempotencyKey:"a",occurredAt:"2026-09-24T16:00:00Z",type:"web_lead",contact:{email:"a@example.com"}});
  const brief=await ownerDailyBrief(store,"t1",{now:new Date("2026-09-24T18:00:00Z"),callActivity:{callsHandled:4,humanTransfers:1}});
  assert.equal(brief.newOpportunities,1);
  assert.equal(brief.callsHandled,4);
  assert.equal(brief.humanTransfers,1);
});

test("Opportunity Timeline is tenant isolated", async()=>{
  const {store,engine}=await fixture();
  const created=await engine.ingest({idempotencyKey:"a",type:"phone_lead",contact:{phone:"+14095550100",transactionalSmsAllowed:true}});
  const timeline=await opportunityTimeline(store,"t1",created.opportunity.id);
  assert.equal(timeline.opportunity.id,created.opportunity.id);
  assert.ok(timeline.timeline.length>0);
  assert.equal(await opportunityTimeline(store,"other",created.opportunity.id),null);
});

test("RadarTrust exposes permissions and blocked automation evidence without secrets", async()=>{
  const {store,engine}=await fixture();
  await engine.ingest({idempotencyKey:"d",type:"customer_dormant",contact:{email:"a@example.com"}});
  const trust=await radarTrust(store,tenant,{callActivity:{knowledgeGaps:2}});
  assert.equal(trust.controls.bookingMode,"confirm_only");
  assert.equal(trust.controls.recordCalls,false);
  assert.equal(trust.callActivity.knowledgeGaps,2);
  assert.ok(trust.actionAudit.totalActions>=1);
  assert.doesNotMatch(JSON.stringify(trust),/secret|token|apiKey/i);
});
