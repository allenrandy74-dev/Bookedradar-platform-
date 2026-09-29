import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  runStartupPostgresJsonRollback,
  syncPostgresSnapshotToJson,
} from "../src/postgres-json-rollback.js";
import { loadMigrationSnapshot } from "../scripts/postgres-migration-audit.mjs";
import { stableHash } from "../src/postgres-migration-audit.js";

function fixtureSnapshot(now = Date.now()) {
  return {
    state:{ processedWebhooks:{wh1:now}, calls:{c1:{tenantId:"demo-hvac",updatedAt:now,marker:"postgres"}} },
    recovery:{
      contacts:{}, opportunities:{}, events:[], eventKeys:{}, actions:{}, attribution:{},
    },
    callHistory:{ calls:{} },
    webChat:{ sessions:{} },
    transfers:{ processedWebhooks:{}, calls:{} },
    growthMetrics:{ counts:{metric:2}, updatedAt:new Date(now).toISOString() },
    billingTest:{ version:1, mode:"test", accounts:{}, events:{} },
    billingLive:null,
    leads:[{tenant_id:"demo-hvac",call_id:"c1",service_type:"repair"}],
  };
}

async function tempEnv(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"br-pg-json-rollback-"));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const data=path.join(root,"data");
  await fs.mkdir(data,{recursive:true});
  return {
    root,
    env:{
      BOOKEDRADAR_STORAGE_BACKEND:"json",
      POSTGRES_JSON_ROLLBACK_ARMED:"true",
      POSTGRES_SHADOW_IMPORT_ON_STARTUP:"false",
      POSTGRES_MIGRATION_ARMED:"false",
      DATABASE_URL:"postgresql://user:secret@internal.render/bookedradar_postgres_production",
      STATE_FILE:path.join(data,"state.json"),
      RECOVERY_STATE_FILE:path.join(data,"recovery-state.json"),
      CALL_HISTORY_FILE:path.join(data,"call-history.json"),
      WEB_CHAT_STATE_FILE:path.join(data,"web-chat.json"),
      GROWTH_METRICS_FILE:path.join(data,"growth-metrics.json"),
      LEADS_FILE:path.join(data,"leads.jsonl"),
      POSTGRES_JSON_ROLLBACK_ID:"rollback-test-0001",
    },
  };
}

function fakePool(snapshot) {
  let ended=false;
  const client={
    async query(sql){ return {rows:[]}; },
    release(){},
  };
  return {
    async connect(){ return client; },
    async end(){ ended=true; },
    get ended(){ return ended; },
    snapshot,
  };
}

test("startup rollback is inert when disabled", async()=>{
  const result=await runStartupPostgresJsonRollback({enabled:false});
  assert.deepEqual(result,{enabled:false,status:"disabled"});
});

test("rollback sync refuses unsafe backend, unarmed, migration-armed, and local database", async(t)=>{
  const {env}=await tempEnv(t);
  await assert.rejects(
    syncPostgresSnapshotToJson({env:{...env,BOOKEDRADAR_STORAGE_BACKEND:"postgres"}}),
    /requires_json_backend/
  );
  await assert.rejects(
    syncPostgresSnapshotToJson({env:{...env,POSTGRES_JSON_ROLLBACK_ARMED:"false"}}),
    /not_armed/
  );
  await assert.rejects(
    syncPostgresSnapshotToJson({env:{...env,POSTGRES_MIGRATION_ARMED:"true"}}),
    /requires_migration_disarmed/
  );
  await assert.rejects(
    syncPostgresSnapshotToJson({
      env:{...env,DATABASE_URL:"postgresql://u:p@127.0.0.1:5432/bookedradar_test"},
    }),
    /requires_managed_database/
  );
});

test("rollback sync replaces stale JSON with exact Postgres snapshot and preserves private backup", async(t)=>{
  const {env}=await tempEnv(t);
  const stale={processedWebhooks:{},calls:{old:{tenantId:"demo-hvac",updatedAt:1,marker:"stale"}}};
  await fs.writeFile(env.STATE_FILE,JSON.stringify(stale));
  const snapshot=fixtureSnapshot();
  let pool;
  const report=await syncPostgresSnapshotToJson({
    env,
    createPool(){
      pool=fakePool(snapshot);
      return pool;
    },
    readSnapshot:async()=>snapshot,
  });
  assert.equal(report.ok,true);
  assert.equal(report.sourceHash,stableHash(snapshot));
  assert.equal(report.restoredHash,stableHash(snapshot));
  assert.equal(report.databaseTouched,false);
  assert.equal(report.postgresAuthoritative,false);
  assert.equal(pool.ended,true);

  const restored=await loadMigrationSnapshot(env);
  assert.equal(stableHash(restored),stableHash(snapshot));
  const backupState=JSON.parse(await fs.readFile(path.join(report.backupDir,"state.bak"),"utf8"));
  assert.deepEqual(backupState,stale);
  const manifest=JSON.parse(await fs.readFile(path.join(report.backupDir,"manifest.json"),"utf8"));
  assert.equal(manifest.sourceHash,stableHash(snapshot));
  assert.equal((await fs.stat(env.STATE_FILE)).mode & 0o777,0o600);
});

test("rollback sync restores original JSON set when post-write validation fails", async(t)=>{
  const {env}=await tempEnv(t);
  const original={processedWebhooks:{},calls:{old:{tenantId:"demo-hvac",updatedAt:1,marker:"original"}}};
  await fs.writeFile(env.STATE_FILE,JSON.stringify(original));
  const snapshot=fixtureSnapshot();
  await assert.rejects(
    syncPostgresSnapshotToJson({
      env,
      createPool(){ return fakePool(snapshot); },
      readSnapshot:async()=>snapshot,
      loadJsonSnapshot:async()=>({bad:"snapshot"}),
    }),
    /content_mismatch/
  );
  const restoredOriginal=JSON.parse(await fs.readFile(env.STATE_FILE,"utf8"));
  assert.deepEqual(restoredOriginal,original);
  await assert.rejects(fs.access(env.RECOVERY_STATE_FILE));
});

test("startup rollback logs success without exposing database secret", async()=>{
  const logs=[];
  const result=await runStartupPostgresJsonRollback({
    enabled:true,
    env:{DATABASE_URL:"postgresql://user:secret-password@internal/db"},
    sync:async()=>({
      ok:true,
      rollbackId:"rollback-success-01",
      sourceHash:"a".repeat(64),
      restoredHash:"a".repeat(64),
      backupDir:"/app/data/.postgres-json-rollback-rollback-success-01",
      filesWritten:8,
      filesDeleted:1,
    }),
    log:(event,fields)=>logs.push({event,...fields}),
  });
  assert.equal(result.ok,true);
  assert.equal(result.status,"validated");
  assert.equal(JSON.stringify(result).includes("secret-password"),false);
  assert.equal(JSON.stringify(logs).includes("secret-password"),false);
});
