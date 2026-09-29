import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { runPostgresShadowMigration } from "../scripts/postgres-shadow-migrate.mjs";
import { loadMigrationSnapshot } from "../scripts/postgres-migration-audit.mjs";
import { auditPostgresMigrationSnapshot } from "../src/postgres-migration-audit.js";
import { PostgresRecoveryStore } from "../src/postgres-recovery-store.js";

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
        sourceEventId:"z-event",
        createdAt:iso,
        updatedAt:iso,
      },
    },
    events: [
      {
        id:"z-event",
        tenantId:tenant,
        type:"missed_call",
        occurredAt:new Date(now-700).toISOString(),
        contactKey,
      },
      {
        id:"a-event",
        idempotencyKey:"evt-key-a",
        tenantId:tenant,
        type:"customer_note",
        occurredAt:new Date(now-600).toISOString(),
        contactKey,
      },
    ],
    eventKeys: { "manual-explicit-key":"z-event", "evt-key-a":"a-event" },
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
  await fs.writeFile(files.WEB_CHAT_STATE_FILE, JSON.stringify(webChat));
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

    const eventOrder = await pool.query(
      "SELECT event_id,source_sequence FROM bookedradar.recovery_events ORDER BY source_sequence,event_id"
    );
    assert.deepEqual(eventOrder.rows.map(row => row.event_id), ["z-event","a-event"]);
    assert.deepEqual(eventOrder.rows.map(row => Number(row.source_sequence)), [0,1]);

    const recoveryStore = new PostgresRecoveryStore(pool, tenant);
    await recoveryStore.ingest({
      id:"m-event",
      idempotencyKey:"evt-key-m",
      type:"missed_call",
      occurredAt:new Date(now+1000).toISOString(),
      contact:{ phone:"+14095550112", transactionalSmsAllowed:true },
    }, {
      tenantId:tenant,
      businessName:"Synthetic HVAC",
      timeZone:"America/Chicago",
      policies:{ sms:{ allowTransactionalWhenInbound:true } },
      economics:{ defaultAverageJobValue:500 },
    });
    const futureSequence = await pool.query(
      "SELECT source_sequence FROM bookedradar.recovery_events WHERE event_id='m-event'"
    );
    assert.equal(Number(futureSequence.rows[0].source_sequence), 2);

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
