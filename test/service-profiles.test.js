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
