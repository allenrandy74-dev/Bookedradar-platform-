import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RecoveryStore } from "../src/recovery/store.js";
import { RecoveryEngine } from "../src/recovery/engine.js";
import { radarProof } from "../src/recovery/radarproof.js";
function rng(seed=123456789){let x=seed>>>0;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;};}
const random=rng(Number(process.env.SIM_SEED||20260917));
const scenarioCount=Math.max(100,Number(process.env.SIM_SCENARIOS||300));
const types=["phone_lead","missed_call","web_lead","after_hours_lead","estimate_sent","appointment_cancelled","customer_dormant"];
function tenant(id,avg){return{tenantId:id,businessName:`${id} Service Co`,trade:"home services",timeZone:"America/Chicago",serviceArea:["Southeast Texas"],escalation:{humanPhone:"+14095550000"},policies:{bookingMode:"confirm_only",quietHours:{start:20,end:8},sms:{allowTransactionalWhenInbound:true}},economics:{defaultAverageJobValue:avg,averageJobValueByType:{repair:avg,replacement:avg*12,maintenance:Math.round(avg*.45)}}};}
const dir=await fs.mkdtemp(path.join(os.tmpdir(),"br-sim-"));
const store=new RecoveryStore(path.join(dir,"state.json"));
const tenants=[tenant("hvac-a",475),tenant("plumbing-b",390),tenant("roofing-c",1300)];
const engines=tenants.map(t=>new RecoveryEngine({store,tenant:t}));
let duplicateAttempts=0,recoveries=0,confirmations=0,optOuts=0;
for(let i=0;i<scenarioCount;i++){
  const engine=engines[Math.floor(random()*engines.length)],t=engine.tenant,type=types[Math.floor(random()*types.length)];
  const phone=`+1409555${String(1000+(i%8999)).slice(-4)}`; const consent=random()<.42;
  const serviceType=random()<.16?"replacement":random()<.35?"maintenance":"repair";
  const event={idempotencyKey:`${t.tenantId}:${type}:${i}`,type,source:`simulation:${type}`,serviceType,urgency:type==="after_hours_lead"&&random()<.2?"urgent":"routine",estimateAmount:type==="estimate_sent"?Math.round((250+random()*12000)*100)/100:undefined,contact:{name:`Sim ${i}`,phone,email:`sim${i}@example.invalid`,transactionalSmsAllowed:true,marketingConsent:consent,smsMarketingConsent:consent}};
  const result=await engine.ingest(event);
  if(random()<.08){duplicateAttempts++;const duplicate=await engine.ingest(event);if(!duplicate.duplicate)throw new Error("Idempotency invariant failed");}
  if(result.opportunity&&random()<.26){recoveries++;await engine.markRecovered(result.opportunity.id,{bookingId:`sim-booking-${i}`});if(random()<.62){confirmations++;const amount=Math.round((Math.max(100,result.opportunity.estimatedOpportunityValue)*(.7+random()*.6))*100)/100;await engine.ingest({idempotencyKey:`revenue:${result.opportunity.id}`,type:"revenue_confirmed",opportunityId:result.opportunity.id,amount,source:"simulation-job-system"});}}
  if(random()<.035){optOuts++;await engine.ingest({idempotencyKey:`optout:${t.tenantId}:${i}`,type:"contact_opted_out",contactKey:phone,contact:{phone},source:"simulation-opt-out"});}
}
const snapshot=await store.snapshot(); const opportunities=Object.values(snapshot.opportunities),actions=Object.values(snapshot.actions);
if(opportunities.length!==scenarioCount)throw new Error(`Opportunity count invariant failed: ${opportunities.length}`);
for(const action of actions){if(!action.tenantId||!action.contactKey.startsWith(`${action.tenantId}:`))throw new Error(`Tenant isolation invariant failed ${action.id}`);}
for(const action of actions.filter(a=>a.purpose==="marketing")){const contact=snapshot.contacts[action.contactKey];if(!contact?.marketingConsent&&action.status!=="blocked")throw new Error(`Consent invariant failed ${action.id}`);}
const reports={}; for(const t of tenants){reports[t.tenantId]=await radarProof(store,t.tenantId);}
console.log(JSON.stringify({ok:true,scenarios:scenarioCount,duplicateAttempts,recoveries,confirmations,optOuts,opportunityCount:opportunities.length,actionCount:actions.length,tenants:reports},null,2));
