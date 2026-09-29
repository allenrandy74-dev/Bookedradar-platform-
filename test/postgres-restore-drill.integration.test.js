import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { Pool } from "pg";

import {
  buildPostgresMigrationManifest,
  stableHash,
} from "../src/postgres-migration-audit.js";
import { readPostgresSnapshot } from "../src/postgres-full-export.js";
import { importMigrationManifest } from "../src/postgres-runtime.js";
import { runPostgresTransactionalRestoreDrill } from "../src/postgres-restore-drill.js";

const connectionString = process.env.POSTGRES_TEST_URL;

function representativeSnapshot() {
  const now = Date.now();
  const iso = new Date(now).toISOString();
  const tenant = "demo-hvac";
  const contactKey = tenant + ":+14095550111";

  return {
    state:{
      processedWebhooks:{ "wh-restore-1":now - 1000 },
      calls:{
        "call-restore-1":{
          tenantId:tenant,
          updatedAt:now,
          lastLead:{ name:"Synthetic", service_type:"repair" },
        },
      },
    },
    callHistory:{
      calls:{
        "call-restore-1":{
          callId:"call-restore-1",
          tenantId:tenant,
          callerMasked:"***0111",
          dialedMasked:"***4186",
          startedAt:now - 4000,
          endedAt:now - 1000,
          updatedAt:now,
          transferred:false,
          spamEnded:false,
          transcript:[
            {
              speaker:"caller",
              text:"Synthetic caller",
              itemId:"turn-1",
              at:new Date(now - 3500).toISOString(),
            },
            {
              speaker:"assistant",
              text:"Synthetic assistant",
              itemId:"turn-2",
              at:new Date(now - 3000).toISOString(),
            },
          ],
        },
      },
    },
    leads:[{
      tenant_id:tenant,
      call_id:"call-restore-1",
      name:"Synthetic",
      service_type:"repair",
      callback_number:"+14095550111",
    }],
    recovery:{
      contacts:{
        [contactKey]:{
          tenantId:tenant,
          contactKey,
          name:"Synthetic",
          phone:"+14095550111",
          updatedAt:iso,
        },
      },
      opportunities:{
        "opp-restore-1":{
          id:"opp-restore-1",
          tenantId:tenant,
          contactKey,
          status:"open",
          sourceEventId:"evt-restore-z",
          createdAt:iso,
          updatedAt:iso,
        },
      },
      events:[
        {
          id:"evt-restore-z",
          idempotencyKey:"restore-z",
          tenantId:tenant,
          type:"missed_call",
          occurredAt:new Date(now - 2500).toISOString(),
          contactKey,
        },
        {
          id:"evt-restore-a",
          idempotencyKey:"restore-a",
          tenantId:tenant,
          type:"manual_note",
          occurredAt:new Date(now - 2000).toISOString(),
          contactKey,
        },
      ],
      eventKeys:{
        "restore-z":"evt-restore-z",
        "restore-a":"evt-restore-a",
        "legacy-restore-alias":"evt-restore-z",
      },
      actions:{
        "act-restore-1":{
          id:"act-restore-1",
          tenantId:tenant,
          opportunityId:"opp-restore-1",
          contactKey,
          channel:"human_task",
          status:"pending",
          dueAt:iso,
          createdAt:iso,
        },
      },
      attribution:{
        "opp-restore-1":{
          opportunityId:"opp-restore-1",
          tenantId:tenant,
          confirmedRevenue:0,
          updatedAt:iso,
        },
      },
    },
    webChat:{ sessions:{} },
    transfers:{
      processedWebhooks:{ "transfer-wh-restore":now - 500 },
      calls:{
        "transfer-restore-1":{
          id:"transfer-restore-1",
          tenantId:tenant,
          callId:"call-restore-1",
          status:"requested",
          updatedAt:now - 800,
        },
      },
    },
    growthMetrics:{
      counts:{ "page_view|hvac|synthetic|default":7 },
      updatedAt:iso,
    },
    billingTest:{
      version:1,
      mode:"test",
      accounts:{ synthetic:{ tenantId:tenant } },
      events:{},
    },
    billingLive:null,
  };
}

test("real Postgres: transactional restore drill rebuilds exact shadow state then rolls everything back", { skip:!connectionString }, async () => {
  const url = new URL(connectionString);
  assert.ok(["localhost","127.0.0.1","[::1]"].includes(url.hostname));
  assert.equal(url.pathname, "/bookedradar_test");

  const pool = new Pool({ connectionString, max:5 });
  const schemaSql = await fs.readFile(
    new URL("../db/postgres-schema.sql", import.meta.url),
    "utf8"
  );

  try {
    await pool.query("DROP SCHEMA IF EXISTS bookedradar CASCADE");
    await pool.query(schemaSql);

    const snapshot = representativeSnapshot();
    const manifest = buildPostgresMigrationManifest(snapshot);
    await importMigrationManifest(pool, manifest, {
      migrationId:"restore-source-seed",
    });

    const before = await pool.connect();
    let beforeSnapshot;
    try {
      await before.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      beforeSnapshot = await readPostgresSnapshot(before);
      await before.query("COMMIT");
    } finally {
      before.release();
    }

    const beforeHash = stableHash(beforeSnapshot);
    const seqBefore = await pool.query(
      "SELECT last_value,is_called FROM bookedradar.recovery_event_sequence"
    );

    const report = await runPostgresTransactionalRestoreDrill(
      pool,
      schemaSql,
      { drillId:"restore_drill_postgres18" }
    );

    assert.equal(report.ok, true);
    assert.equal(report.rollbackVerified, true);
    assert.equal(report.databaseChanged, false);
    assert.equal(report.cutoverPerformed, false);
    assert.equal(report.reconciliation.ok, true);
    assert.deepEqual(report.reconciliation.mismatches, []);
    assert.equal(report.sourceHash, beforeHash);
    assert.equal(report.restoredHash, beforeHash);
    assert.ok(Number.isFinite(report.elapsedMs));
    assert.ok(report.elapsedMs >= 0);

    const after = await pool.connect();
    let afterSnapshot;
    try {
      await after.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      afterSnapshot = await readPostgresSnapshot(after);
      await after.query("COMMIT");
    } finally {
      after.release();
    }
    assert.equal(stableHash(afterSnapshot), beforeHash);
    assert.deepEqual(afterSnapshot, beforeSnapshot);

    const tempSchemas = await pool.query(
      "SELECT nspname FROM pg_namespace WHERE nspname LIKE 'br_restore_source_%'"
    );
    assert.deepEqual(tempSchemas.rows, []);

    const seqAfter = await pool.query(
      "SELECT last_value,is_called FROM bookedradar.recovery_event_sequence"
    );
    assert.deepEqual(seqAfter.rows, seqBefore.rows);

    const migrations = await pool.query(
      "SELECT migration_id FROM bookedradar.migration_runs ORDER BY migration_id"
    );
    assert.deepEqual(
      migrations.rows.map(row => row.migration_id),
      ["restore-source-seed"]
    );
  } finally {
    await pool.query("DROP SCHEMA IF EXISTS bookedradar CASCADE");
    await pool.end();
  }
});
