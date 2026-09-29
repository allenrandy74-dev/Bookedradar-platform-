import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { applyPostgresSchema, importMigrationManifest } from "../src/postgres-runtime.js";
import {
  auditPostgresMigrationSnapshot,
  buildPostgresMigrationManifest,
  stableHash,
} from "../src/postgres-migration-audit.js";
import { readPostgresSnapshot } from "../src/postgres-full-export.js";
import { PostgresCallStateStore } from "../src/postgres-state-store.js";
import { PostgresLeadStore } from "../src/postgres-lead-store.js";
import { syncPostgresSnapshotToJson } from "../src/postgres-json-rollback.js";
import { loadMigrationSnapshot } from "../scripts/postgres-migration-audit.mjs";

const connectionString=process.env.POSTGRES_TEST_URL;

function sourceSnapshot(now=Date.now()){
  return {
    state:{processedWebhooks:{wh1:now},calls:{}},
    recovery:{contacts:{},opportunities:{},events:[],eventKeys:{},actions:{},attribution:{}},
    callHistory:{calls:{}},
    webChat:{sessions:{}},
    transfers:{processedWebhooks:{},calls:{}},
    growthMetrics:{counts:{seed:1},updatedAt:new Date(now).toISOString()},
    billingTest:{version:1,mode:"test",accounts:{},events:{}},
    billingLive:null,
    leads:[],
  };
}

test("real Postgres 18: rollback sync restores current Postgres authority to JSON exactly", {skip:!connectionString}, async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"br-pg-json-rollback-int-"));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const dataDir=path.join(root,"data");
  await fs.mkdir(dataDir,{recursive:true});

  const env={
    BOOKEDRADAR_STORAGE_BACKEND:"json",
    POSTGRES_JSON_ROLLBACK_ARMED:"true",
    POSTGRES_SHADOW_IMPORT_ON_STARTUP:"false",
    POSTGRES_MIGRATION_ARMED:"false",
    POSTGRES_JSON_ROLLBACK_ID:"rollback-integration-01",
    // Safety validation sees a managed-style URL; createPool below intentionally
    // redirects only this disposable integration test to local Postgres.
    DATABASE_URL:"postgresql://user:secret@internal.render/bookedradar_postgres_production",
    STATE_FILE:path.join(dataDir,"state.json"),
    RECOVERY_STATE_FILE:path.join(dataDir,"recovery-state.json"),
    CALL_HISTORY_FILE:path.join(dataDir,"call-history.json"),
    WEB_CHAT_STATE_FILE:path.join(dataDir,"web-chat.json"),
    GROWTH_METRICS_FILE:path.join(dataDir,"growth-metrics.json"),
    LEADS_FILE:path.join(dataDir,"leads.jsonl"),
  };

  const setup=new Pool({connectionString});
  try{
    await setup.query("DROP SCHEMA IF EXISTS bookedradar CASCADE");
    const schemaSql=await fs.readFile(new URL("../db/postgres-schema.sql",import.meta.url),"utf8");
    await applyPostgresSchema(setup,schemaSql);

    const initial=sourceSnapshot();
    const audit=auditPostgresMigrationSnapshot(initial);
    assert.equal(audit.ok,true);
    const manifest=buildPostgresMigrationManifest(initial);
    await importMigrationManifest(setup,manifest,{migrationId:"rollback-seed"});

    // Simulate writes that occurred only after Postgres became authoritative.
    const stateStore=new PostgresCallStateStore(setup,"demo-hvac");
    await stateStore.patchCall("post-cutover-call",{
      tenantId:"demo-hvac",
      marker:"post-cutover",
      updatedAt:Date.now(),
    });
    const leadStore=new PostgresLeadStore(setup,"demo-hvac");
    await leadStore.append({
      tenant_id:"demo-hvac",
      call_id:"post-cutover-call",
      name:"Synthetic Post-Cutover",
      service_type:"repair",
    });

    // Deliberately stale JSON that would lose the new call/lead if used directly.
    await fs.writeFile(env.STATE_FILE,JSON.stringify({
      processedWebhooks:{},
      calls:{stale:{tenantId:"demo-hvac",updatedAt:1}},
    }));
    await fs.writeFile(path.join(dataDir,"billing-live-state.json"),JSON.stringify({
      version:1,mode:"live",accounts:{stale:true},events:{},
    }));

    let expected;
    const reader=await setup.connect();
    try{
      await reader.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      expected=await readPostgresSnapshot(reader);
      await reader.query("COMMIT");
    }finally{reader.release();}

    const report=await syncPostgresSnapshotToJson({
      env,
      createPool:()=>new Pool({connectionString}),
    });
    assert.equal(report.ok,true);
    assert.equal(report.sourceHash,stableHash(expected));
    assert.equal(report.restoredHash,stableHash(expected));

    const jsonSnapshot=await loadMigrationSnapshot(env);
    assert.equal(stableHash(jsonSnapshot),stableHash(expected));
    assert.equal(jsonSnapshot.state.calls["post-cutover-call"].marker,"post-cutover");
    assert.equal(jsonSnapshot.leads.some(row=>row.call_id==="post-cutover-call"),true);
    await assert.rejects(fs.access(path.join(dataDir,"billing-live-state.json")));

    const backupState=JSON.parse(
      await fs.readFile(path.join(report.backupDir,"state.bak"),"utf8")
    );
    assert.ok(backupState.calls.stale);
  }finally{
    await setup.query("DROP SCHEMA IF EXISTS bookedradar CASCADE");
    await setup.end();
  }
});
