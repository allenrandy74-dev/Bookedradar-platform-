import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { runPostgresShadowMigration } from "../scripts/postgres-shadow-migrate.mjs";
import { loadMigrationSnapshot } from "../scripts/postgres-migration-audit.mjs";
import { auditPostgresMigrationSnapshot } from "../src/postgres-migration-audit.js";

const connectionString = process.env.POSTGRES_TEST_URL;

test("real Postgres: audited production-style snapshot imports and reconciles exact content", { skip: !connectionString }, async t => {
  const url = new URL(connectionString);
  assert.ok(["localhost","127.0.0.1","[::1]"].includes(url.hostname));
  assert.equal(url.pathname, "/bookedradar_test");

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "br-shadow-exact-"));
  t.after(() => fs.rm(root, { recursive:true, force:true }));
  const dataDir = path.join(root, "data");
  await fs.mkdir(dataDir, { recursive:true });

  const now = Date.now();
  const iso = new Date(now).toISOString();
  const tenant = "demo-hvac";
  const contactKey = tenant + ":+14095550111";

  const state = {
    processedWebhooks: { "wh-1": now },
    calls: {
      "call-1": {
        tenantId: tenant,
        updatedAt: now,
        lastLead: { name:"Synthetic", service_type:"repair" },
      },
    },
  };
  const callHistory = {
    calls: {
      "call-1": {
        callId:"call-1",
        tenantId:tenant,
        callerMasked:"***0111",
        dialedMasked:"***4186",
        startedAt:now-1000,
        endedAt:now,
        updatedAt:now,
        transferred:false,
        spamEnded:false,
        transcript:[
          { speaker:"caller", text:"Synthetic caller", itemId:"i1", at:new Date(now-900).toISOString() },
          { speaker:"assistant", text:"Synthetic reply", itemId:"i2", at:new Date(now-800).toISOString() },
        ],
      },
    },
  };
  const leads = [{
    tenant_id:tenant,
    call_id:"call-1",
    name:"Synthetic",
    service_type:"repair",
    callback_number:"+14095550111",
  }];
  const recovery = {
    contacts: {
      [contactKey]: {
        tenantId:tenant,
        contactKey,
        name:"Synthetic",
        phone:"+14095550111",
        updatedAt:iso,
      },
    },
    opportunities: {
      "opp-1": {
        id:"opp-1",
        tenantId:tenant,
        contactKey,
        status:"open",
        sourceEventId:"evt-1",
        createdAt:iso,
        updatedAt:iso,
      },
    },
    events: [
      {
        id:"evt-z",
        tenantId:tenant,
        type:"manual_note",
        occurredAt:new Date(now-750).toISOString(),
        contactKey,
      },
      {
        id:"evt-1",
        idempotencyKey:"evt-key-1",
        tenantId:tenant,
        type:"missed_call",
        occurredAt:iso,
        contactKey,
      }
    ],
    eventKeys: {
      "manual-explicit-key":"evt-z",
      "evt-key-1":"evt-1"
    },
    actions: {
      "act-1": {
        id:"act-1",
        tenantId:tenant,
        opportunityId:"opp-1",
        contactKey,
        channel:"human_task",
        status:"pending",
        dueAt:iso,
        createdAt:iso,
      },
    },
    attribution: {
      "opp-1": {
        opportunityId:"opp-1",
        tenantId:tenant,
        confirmedRevenue:0,
        updatedAt:iso,
      },
    },
  };
  const webChat = {
    sessions: {
      "chat-1": {
        id:"chat-1",
        tenantId:tenant,
        opportunityId:"opp-1",
        createdAt:now-500,
        updatedAt:now-400,
        messages:[],
        fields:{},
      },
    },
  };
  const transfers = {
    processedWebhooks:{ "transfer-hook-1":now-250 },
    calls:{
      "transfer-1":{
        id:"transfer-1",
        tenantId:tenant,
        callId:"call-1",
        status:"requested",
        updatedAt:now-300,
      },
    },
  };
  const growth = {
    counts:{ "page_view|hvac|synthetic|default":2 },
    updatedAt:iso,
  };
  const billingTest = {
    version:1,
    mode:"test",
    accounts:{ synthetic:{ tenantId:tenant } },
    events:{},
  };

  const files = {
    STATE_FILE:path.join(dataDir,"state.json"),
    RECOVERY_STATE_FILE:path.join(dataDir,"recovery-state.json"),
    CALL_HISTORY_FILE:path.join(dataDir,"call-history.json"),
    WEB_CHAT_STATE_FILE:path.join(dataDir,"web-chat.json"),
    GROWTH_METRICS_FILE:path.join(dataDir,"growth-metrics.json"),
    LEADS_FILE:path.join(dataDir,"leads.jsonl"),
  };
  await fs.writeFile(files.STATE_FILE, JSON.stringify(state));
  await fs.writeFile(files.RECOVERY_STATE_FILE, JSON.stringify(recovery));
  await fs.writeFile(files.CALL_HISTORY_FILE, JSON.stringify(callHistory));
  // Production currently has no web-chat.json file. Missing WebChat state is
  // semantically the same as the canonical empty store { sessions: {} }.
  await fs.writeFile(files.GROWTH_METRICS_FILE, JSON.stringify(growth));
  await fs.writeFile(path.join(dataDir,"voice-transfers.json"), JSON.stringify(transfers));
  await fs.writeFile(path.join(dataDir,"billing-test-state.json"), JSON.stringify(billingTest));
  await fs.writeFile(files.LEADS_FILE, leads.map(x=>JSON.stringify(x)+"\n").join(""));

  const snapshot = await loadMigrationSnapshot(files);
  const audit = auditPostgresMigrationSnapshot(snapshot);
  assert.equal(audit.ok, true);
  assert.equal(audit.warnings.length, 0);

  const pool = new Pool({ connectionString });
  try {
    await pool.query("DROP SCHEMA IF EXISTS bookedradar CASCADE");
    const result = await runPostgresShadowMigration({
      ...files,
      DATABASE_URL:connectionString,
      POSTGRES_MIGRATION_DRY_RUN:"false",
      POSTGRES_MIGRATION_ARMED:"true",
      POSTGRES_MIGRATION_ALLOW_WARNINGS:"false",
      POSTGRES_MIGRATION_EXPECTED_FINGERPRINT:audit.snapshotFingerprint,
      POSTGRES_MIGRATION_ID:"synthetic-production-shadow",
    });

    assert.equal(result.ok, true);
    assert.equal(result.stage, "validated_shadow");
    assert.equal(result.databaseTouched, true);
    assert.equal(result.cutoverPerformed, false);
    assert.equal(result.reconciliation.ok, true);
    assert.equal(result.contentReconciliation.ok, true);
    assert.equal(result.contentReconciliation.sourceContentHash, result.contentReconciliation.postgresContentHash);
    assert.notEqual(result.contentReconciliation.rawSourceContentHash, result.contentReconciliation.rawPostgresContentHash);
    assert.deepEqual(result.contentReconciliation.sourceNormalizations, ["webChat:null_to_empty_store"]);
    assert.deepEqual(result.contentReconciliation.postgresNormalizations, []);

    const migration = await pool.query(
      "SELECT status,validation FROM bookedradar.migration_runs WHERE migration_id=$1",
      ["synthetic-production-shadow"]
    );
    assert.equal(migration.rows[0].status, "validated");
    assert.equal(migration.rows[0].validation.content.ok, true);
    assert.equal(migration.rows[0].validation.tableCounts.ok, true);
  } finally {
    await pool.query("DROP SCHEMA IF EXISTS bookedradar CASCADE");
    await pool.end();
  }
});
