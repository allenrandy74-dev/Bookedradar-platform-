import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { RecoveryStore } from '../src/recovery/store.js';
import { RecoveryEngine } from '../src/recovery/engine.js';
const tenant={tenantId:'synthetic-terminal',economics:{defaultAverageJobValue:100}};
for(const first of ['opportunity_won','opportunity_lost','booking_confirmed']) {
  for(const next of ['opportunity_won','opportunity_lost','booking_confirmed']) {
    test(`first terminal outcome persists: ${first} then ${next}`,async t=>{
      const dir=await fs.mkdtemp(path.join(os.tmpdir(),'br-terminal-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
      const store=new RecoveryStore(path.join(dir,'recovery.json')),engine=new RecoveryEngine({store,tenant});
      const lead=await engine.ingest({type:'phone_lead',contact:{phone:'+12025550101'}});
      await engine.ingest({type:first,opportunityId:lead.opportunity.id,bookingId:'first',estimatedRecoveredValue:50});
      const before=await store.snapshot();
      const result=await engine.ingest({type:next,opportunityId:lead.opportunity.id,bookingId:'second',estimatedRecoveredValue:999});
      assert.equal(result.ignored,true);
      const after=await store.snapshot();
      assert.deepEqual(after.opportunities,before.opportunities);
      assert.deepEqual(after.attribution,before.attribution);
      assert.deepEqual(after.actions,before.actions);
      assert.equal(after.events.length,before.events.length+1);
      await assert.rejects(engine.markRecovered(lead.opportunity.id,{bookingId:'replacement'}),/terminal_outcome_conflict/);
      assert.deepEqual((await store.snapshot()).opportunities,before.opportunities);
    });
  }
}
