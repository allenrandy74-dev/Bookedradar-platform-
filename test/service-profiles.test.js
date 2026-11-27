import test from "node:test";
import assert from "node:assert/strict";
import { applyServiceProfile, deployableCapabilities, serviceProfile } from "../src/onboarding/service-profiles.js";

test("Recover profile keeps provider-dependent capabilities fail closed", () => {
  const tenant=applyServiceProfile({
    integrations:{phone:{enabled:true},sms:{type:"twilio",enabled:false},webChat:{enabled:false},calendar:{enabled:false}},
    policies:{bookingMode:"confirm_only"},
    commercial:{},
  },"recover");
  assert.equal(tenant.commercial.serviceProfile,"recover");
  assert.equal(tenant.commercial.dispatchMode,"shadow");
  assert.equal(tenant.features.callerMemory,true);
  assert.equal(tenant.features.knowledgeGapLearning,true);
  assert.equal(tenant.features.twoWaySms,false);
  assert.equal(tenant.features.webChat,false);
  assert.equal(tenant.features.noShowGuard,false);
});

test("Grow profile does not turn messaging on without an enabled provider", () => {
  const tenant=applyServiceProfile({
    integrations:{sms:{type:"twilio",enabled:false}},
    policies:{bookingMode:"confirm_only"},
  },"grow");
  assert.equal(tenant.features.membershipRadar,true);
  assert.equal(tenant.features.reviewRadar,true);
  assert.equal(tenant.features.noShowGuard,false);
});

test("unknown profile is rejected", () => {
  assert.throws(()=>serviceProfile("mystery"),/Unknown BookedRadar service profile/);
});

test("deployable capability report reflects actual enabled state, not requested features", () => {
  const report=deployableCapabilities({
    features:{callerMemory:true,twoWaySms:true,webChat:true,languages:["en","es"],knowledgeGapLearning:true},
    integrations:{phone:{enabled:true},sms:{enabled:false},webChat:{enabled:false}},
    policies:{bookingMode:"confirm_only",transcriptRetentionApproved:false},
    commercial:{schedulingApproved:false},
  });
  assert.equal(report.voice,true);
  assert.equal(report.twoWaySms,false);
  assert.equal(report.webChat,false);
  assert.equal(report.bilingualEnglishSpanish,true);
});


test("service profiles use published standard rates and retain Founding terms", () => {
  const expected = {
    answer: { monthlyUsd: 99, standardSetupUsd: 199, foundingMonthlyUsd: 149, foundingSetupUsd: 0 },
    recover: { monthlyUsd: 179, standardSetupUsd: 499, foundingMonthlyUsd: 397, foundingSetupUsd: 0 },
    grow: { monthlyUsd: 249, standardSetupUsd: 749, foundingMonthlyUsd: 597, foundingSetupUsd: 0 },
    schedule: { monthlyUsd: 349, standardSetupUsd: 999, foundingMonthlyUsd: 797, foundingSetupUsd: 0 },
  };
  for (const [id, pricing] of Object.entries(expected)) {
    assert.deepEqual(serviceProfile(id).pricing, pricing, id);
  }
});


test("higher packages preserve lower-tier entitlements", () => {
  const answer=serviceProfile("answer").features;
  const recover=serviceProfile("recover").features;
  const grow=serviceProfile("grow").features;
  const schedule=serviceProfile("schedule").features;
  const keys=["callerMemory","spamScreening","transcriptHistory","knowledgeGapLearning"];
  for(const key of keys){
    assert.equal(answer[key]===true && recover[key]===true && grow[key]===true && schedule[key]===true,true,key);
  }
  for(const key of ["callerTexting","twoWaySms","webChat","reviewRadar"]){
    assert.equal(recover[key],true,key);
    assert.equal(grow[key],true,key);
    assert.equal(schedule[key],true,key);
  }
  for(const key of ["membershipRadar","noShowGuard"]){
    assert.equal(grow[key],true,key);
    assert.equal(schedule[key],true,key);
  }
});
