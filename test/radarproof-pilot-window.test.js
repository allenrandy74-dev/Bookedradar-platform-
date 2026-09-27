import test from "node:test";
import assert from "node:assert/strict";
import { radarProof } from "../src/recovery/radarproof.js";

test("pilot-window RadarProof excludes pre-pilot opportunities", async () => {
  const store={snapshot:async()=>({
    opportunities:{
      old:{id:"old",tenantId:"t1",source:"phone",createdAt:"2026-09-01T00:00:00Z",estimatedOpportunityValue:100},
      new:{id:"new",tenantId:"t1",source:"phone",createdAt:"2026-09-28T00:00:00Z",estimatedOpportunityValue:200}
    },
    attribution:{
      old:{opportunityId:"old",tenantId:"t1",createdAt:"2026-09-01T00:00:00Z",confirmedRevenue:100,recovered:true},
      new:{opportunityId:"new",tenantId:"t1",createdAt:"2026-09-28T00:00:00Z",confirmedRevenue:200,recovered:true}
    },
    actions:{},
    events:[]
  })};
  const report=await radarProof(store,"t1",{sinceMs:Date.parse("2026-09-27T00:00:00Z")});
  assert.equal(report.opportunitiesCaptured,1);
  assert.equal(report.confirmedRevenue,200);
  assert.equal(report.recoveredOpportunities,1);
});

test("RadarProof keeps estimated value separate from confirmed revenue", async () => {
  const store={snapshot:async()=>({
    opportunities:{a:{id:"a",tenantId:"t1",source:"estimate",createdAt:"2026-09-28T00:00:00Z",estimatedOpportunityValue:5000}},
    attribution:{a:{opportunityId:"a",tenantId:"t1",createdAt:"2026-09-28T00:00:00Z",estimatedOpportunityValue:5000,confirmedRevenue:0,recovered:false}},
    actions:{},events:[]
  })};
  const report=await radarProof(store,"t1");
  assert.equal(report.estimatedOpportunityValue,5000);
  assert.equal(report.confirmedRevenue,0);
  assert.match(report.disclaimer,/not confirmed revenue/i);
});
