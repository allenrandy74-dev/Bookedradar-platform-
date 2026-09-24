import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RecoveryStore } from "../src/recovery/store.js";
import { RecoveryEngine } from "../src/recovery/engine.js";
import {
  cancellationBackfillCandidates,
  customer360,
  membershipRadar,
  ownerDailyBrief,
  opportunityTimeline,
  radarTrust,
  revenueLeakRadar,
  reviewRadar,
  searchCustomers,
} from "../src/growth-intelligence.js";

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


test("Cancellation backfill returns matching earlier-slot requests without contacting them", async()=>{
  const {store,engine}=await fixture();
  const wait=await engine.ingest({
    idempotencyKey:"wait",
    type:"earlier_slot_requested",
    serviceType:"AC repair",
    contact:{name:"Pat",phone:"+14095550111",transactionalSmsAllowed:true},
    metadata:{city:"Silsbee",preferredWindow:"any morning"}
  });
  const cancelled=await engine.ingest({
    idempotencyKey:"cancel",
    type:"appointment_cancelled",
    serviceType:"AC repair",
    contact:{name:"Other",phone:"+14095550112",transactionalSmsAllowed:true},
    metadata:{city:"Silsbee",scheduledFor:"2026-09-25T14:00:00Z"}
  });
  const result=await cancellationBackfillCandidates(store,"t1",cancelled.opportunity.id,{now:new Date("2026-09-24T18:00:00Z")});
  assert.equal(result.candidateCount,1);
  assert.equal(result.candidates[0].opportunityId,wait.opportunity.id);
  assert.equal(result.candidates[0].contact.phone,"***0111");
  assert.match(result.action,/Review candidates/);
});

test("Review Radar excludes complaints and unknown satisfaction", async()=>{
  const {store,engine}=await fixture();
  await engine.ingest({idempotencyKey:"good",type:"job_completed",contact:{name:"Happy",email:"h@example.com"},metadata:{jobId:"j1",customerSatisfactionKnown:true,customerSatisfied:true,complaintOpen:false}});
  await engine.ingest({idempotencyKey:"bad",type:"job_completed",contact:{name:"Concern",email:"c@example.com"},metadata:{jobId:"j2",customerSatisfactionKnown:true,customerSatisfied:false,complaintOpen:true}});
  const result=await reviewRadar(store,"t1");
  assert.equal(result.eligibleCount,1);
  assert.equal(result.needsReviewCount,1);
  assert.equal(result.needsReview[0].reason,"open_complaint");
});

test("Membership Radar orders upcoming renewals", async()=>{
  const {store,engine}=await fixture();
  await engine.ingest({idempotencyKey:"m1",type:"membership_renewal_due",contact:{name:"A",email:"a@example.com"},metadata:{membershipId:"m1",membershipName:"Gold",renewalDate:"2026-09-30T00:00:00Z"}});
  await engine.ingest({idempotencyKey:"m2",type:"membership_renewal_due",contact:{name:"B",email:"b@example.com"},metadata:{membershipId:"m2",membershipName:"Silver",renewalDate:"2026-09-27T00:00:00Z"}});
  const result=await membershipRadar(store,"t1",{now:new Date("2026-09-24T00:00:00Z")});
  assert.equal(result.renewalCount,2);
  assert.equal(result.renewals[0].membershipId,"m2");
});


test("Customer 360 summarizes tenant-isolated history and masks contact channels", async()=>{
  const {store,engine}=await fixture();
  await engine.ingest({
    idempotencyKey:"c360",
    type:"phone_lead",
    serviceType:"AC repair",
    urgency:"urgent",
    contact:{name:"Alex Smith",phone:"+14095550123",email:"alex@example.com",transactionalSmsAllowed:true},
    metadata:{serviceAddress:"123 Oak",city:"Silsbee",notes:"Gate on left",preferredWindow:"today"}
  });
  const key="t1:+14095550123";
  const profile=await customer360(store,"t1",key);
  assert.equal(profile.customer.name,"Alex Smith");
  assert.equal(profile.customer.phone,"***0123");
  assert.equal(profile.customer.email,"a***@example.com");
  assert.equal(profile.properties[0].city,"Silsbee");
  assert.equal(profile.technicianBrief.lastServiceType,"AC repair");
  assert.equal(await customer360(store,"other",key),null);
});

test("Customer search returns masked tenant-scoped matches", async()=>{
  const {store,engine}=await fixture();
  await engine.ingest({idempotencyKey:"s",type:"phone_lead",contact:{name:"Jordan Lee",phone:"+14095550199",transactionalSmsAllowed:true}});
  const results=await searchCustomers(store,"t1","Jordan");
  assert.equal(results.length,1);
  assert.equal(results[0].phone,"***0199");
  assert.equal((await searchCustomers(store,"other","Jordan")).length,0);
});
