import test from "node:test";
import assert from "node:assert/strict";
import { diagnoseMigrationDifference } from "../src/postgres-migration-diff.js";
import { runStartupMigrationDiff } from "../src/postgres-startup-migration-diff.js";

function snapshot() {
  return {
    state:{ processedWebhooks:{ w1:1 }, calls:{ c1:{tenantId:"demo-hvac"} } },
    callHistory:{ calls:{} },
    leads:[],
    recovery:{
      contacts:{ "demo-hvac:+14095550101":{tenantId:"demo-hvac",name:"Private Name"} },
      opportunities:{},
      events:[{id:"z-event"},{id:"a-event"}],
      eventKeys:{},
      actions:{},
      attribution:{},
    },
    webChat:{sessions:{}},
    transfers:{processedWebhooks:{},calls:{}},
    growthMetrics:{counts:{a:1},updatedAt:null},
    billingTest:null,
    billingLive:null,
  };
}

test("migration diff identifies ordering-only array drift without exposing payload content", () => {
  const source=snapshot();
  const postgres=structuredClone(source);
  postgres.recovery.events=[postgres.recovery.events[1],postgres.recovery.events[0]];
  const result=diagnoseMigrationDifference(source,postgres);
  assert.equal(result.equal,false);
  assert.equal(result.mismatchCount,2);
  const events = result.mismatches.find(x=>x.component==="recoveryEvents");
  assert.ok(events);
  assert.equal(events.sameMultiset,true);
  assert.equal(events.positionalMismatchCount,2);
  assert.ok(result.mismatches.some(x=>x.component==="recoveryWhole"));
  const serialized=JSON.stringify(result);
  assert.equal(serialized.includes("z-event"),false);
  assert.equal(serialized.includes("a-event"),false);
});

test("migration diff reports map mismatch counts without leaking sensitive keys or values", () => {
  const source=snapshot();
  const postgres=structuredClone(source);
  postgres.recovery.contacts["demo-hvac:+14095550101"].name="Different Private Name";
  const result=diagnoseMigrationDifference(source,postgres);
  const mismatch=result.mismatches.find(x=>x.component==="recoveryContacts");
  assert.ok(mismatch);
  assert.equal(mismatch.sharedMismatchCount,1);
  const serialized=JSON.stringify(result);
  assert.equal(serialized.includes("+14095550101"),false);
  assert.equal(serialized.includes("Private Name"),false);
});

test("startup migration diff uses a repeatable-read transaction and never writes", async () => {
  const source=snapshot();
  const postgres=structuredClone(source);
  const queries=[];
  let released=false, ended=false;
  const client={
    async query(sql){
      queries.push(String(sql));
      if(String(sql)==="BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY") return {rows:[]};
      if(String(sql)==="COMMIT") return {rows:[]};
      throw new Error("unexpected_query");
    },
    release(){released=true;},
  };
  const pool={
    async connect(){return client;},
    async end(){ended=true;},
  };
  const logs=[];
  const result=await runStartupMigrationDiff({
    enabled:true,
    env:{DATABASE_URL:"postgresql://user:secret-password@internal/db"},
    loadSnapshot:async()=>source,
    createPool:()=>pool,
    readSnapshot:async()=>postgres,
    log:(event,fields)=>logs.push({event,...fields}),
  });
  assert.equal(result.ok,true);
  assert.equal(result.equal,true);
  assert.equal(result.databaseTouched,false);
  assert.equal(result.cutoverPerformed,false);
  assert.deepEqual(queries,["BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY","COMMIT"]);
  assert.equal(released,true);
  assert.equal(ended,true);
  assert.equal(JSON.stringify(result).includes("secret-password"),false);
  assert.equal(logs[0].event,"postgres_migration.diff");
});

test("startup migration diff remains inert when disabled", async () => {
  let connected=false;
  const result=await runStartupMigrationDiff({
    enabled:false,
    createPool:()=>{connected=true;throw new Error("should_not_run");},
  });
  assert.deepEqual(result,{enabled:false,status:"disabled"});
  assert.equal(connected,false);
});
