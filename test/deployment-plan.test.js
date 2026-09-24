import test from "node:test";
import assert from "node:assert/strict";
import { deploymentPlan } from "../src/onboarding/deployment-plan.js";
import { applyServiceProfile } from "../src/onboarding/service-profiles.js";

function base(){
  return applyServiceProfile({
    tenantId:"pilot",
    businessName:"Pilot HVAC",
    trade:"HVAC",
    timeZone:"America/Chicago",
    serviceArea:["Silsbee"],
    services:["AC repair"],
    businessHours:{mon:["08:00","17:00"]},
    escalation:{humanPhone:"+14095550100",safetyRule:"Escalate emergencies."},
    policies:{bookingMode:"confirm_only",transcriptRetentionApproved:false},
    integrations:{
      phone:{enabled:true,inboundNumbers:["+14095550101"]},
      crm:{enabled:false},
      sms:{type:"twilio",enabled:false},
      email:{enabled:false},
      calendar:{enabled:false},
      webChat:{enabled:false,allowedOrigins:[]},
    },
    secretsPrefix:"PILOT",
  },"recover");
}

test("deployment plan separates active from entitled-but-gated features",()=>{
  const plan=deploymentPlan(base(),{env:{},foundingPartner:true});
  assert.equal(plan.package.name,"RadarRecover");
  assert.equal(plan.package.pricing.monthlyUsd,397);
  assert.equal(plan.deploymentDecision,"CORE_READY_FOR_ACCEPTANCE_TEST");
  assert.equal(plan.features.find(x=>x.key==="callerMemory").status,"ACTIVE");
  assert.equal(plan.features.find(x=>x.key==="twoWaySms").status,"GATED");
  assert.equal(plan.features.find(x=>x.key==="transcriptHistory").status,"GATED");
  assert.equal(plan.liveBooking.status,"NOT_INCLUDED");
});

test("RadarSchedule booking remains gated until separately activated",()=>{
  const tenant=applyServiceProfile(base(),"schedule");
  const plan=deploymentPlan(tenant,{env:{}});
  assert.equal(plan.package.name,"RadarSchedule");
  assert.equal(plan.liveBooking.included,true);
  assert.equal(plan.liveBooking.status,"GATED");
});
