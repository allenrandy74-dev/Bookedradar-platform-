import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { Pool } from "pg";
import { applyPostgresSchema } from "../src/postgres-runtime.js";
import { createPostgresServerStores } from "../src/postgres-server-stores.js";

const connectionString = process.env.POSTGRES_TEST_URL;
const fingerprint = "4de6c957e16a247a73cbff78cd2ce175044995b7e83fd0aecd1940bd120bd75e";

test("real Postgres 18: production store factory requires and uses validated migration", { skip: !connectionString }, async () => {
  const url = new URL(connectionString);
  assert.ok(["localhost","127.0.0.1","[::1]"].includes(url.hostname));
  assert.equal(url.pathname, "/bookedradar_test");

  const setup = new Pool({ connectionString });
  let stores;
  try {
    await setup.query("DROP SCHEMA IF EXISTS bookedradar CASCADE");
    const schemaSql = await fs.readFile(new URL("../db/postgres-schema.sql", import.meta.url), "utf8");
    await applyPostgresSchema(setup, schemaSql);
    await setup.query(
      `INSERT INTO bookedradar.migration_runs
        (migration_id,source_snapshot_sha256,started_at,completed_at,status,counts,validation)
       VALUES ($1,$2,now(),now(),'validated',$3::jsonb,$4::jsonb)`,
      [
        "ci-production-cutover",
        fingerprint,
        JSON.stringify({ voiceCalls:0 }),
        JSON.stringify({
          tableCounts:{ ok:true, mismatches:[] },
          content:{
            ok:true,
            sourceContentHash:"semantic-equal",
            postgresContentHash:"semantic-equal",
          },
        }),
      ]
    );

    stores = await createPostgresServerStores({
      connectionString,
      mode:"production",
      migrationId:"ci-production-cutover",
      snapshotFingerprint:fingerprint,
    });

    assert.equal(stores.mode, "production");
    assert.deepEqual(stores.productionValidation, {
      migrationId:"ci-production-cutover",
      snapshotFingerprint:fingerprint,
      validated:true,
    });

    const patched = await stores.state.patchCall("ci-call-1", {
      tenantId:"demo-hvac",
      marker:"production-store",
    });
    assert.equal(patched.tenantId, "demo-hvac");
    const read = await stores.state.getCall("ci-call-1");
    assert.equal(read.marker, "production-store");

    await stores.callHistory.start("ci-call-1", {
      tenantId:"demo-hvac",
      callerMasked:"***0001",
      dialedMasked:"***4186",
    });
    await stores.callHistory.mark("ci-call-1", "call.accepted", { latencyMs:10 });
    await stores.callHistory.finish("ci-call-1");
    const history = await stores.callHistory.get("demo-hvac","ci-call-1");
    assert.equal(history.tenantId, "demo-hvac");
    assert.equal(history.milestones["call.accepted"].latencyMs, 10);

    await stores.appendLead({
      tenant_id:"demo-hvac",
      call_id:"ci-call-1",
      name:"Synthetic Production Cutover",
      service_type:"repair",
    });
    const leadCount = await stores.pool.query(
      "SELECT count(*)::int AS count FROM bookedradar.lead_captures WHERE tenant_id=$1",
      ["demo-hvac"]
    );
    assert.equal(leadCount.rows[0].count, 1);
  } finally {
    if (stores) await stores.close();
    await setup.query("DROP SCHEMA IF EXISTS bookedradar CASCADE");
    await setup.end();
  }
});

test("real Postgres 18: production store factory refuses unvalidated migration", { skip: !connectionString }, async () => {
  const setup = new Pool({ connectionString });
  try {
    await setup.query("DROP SCHEMA IF EXISTS bookedradar CASCADE");
    const schemaSql = await fs.readFile(new URL("../db/postgres-schema.sql", import.meta.url), "utf8");
    await applyPostgresSchema(setup, schemaSql);
    await assert.rejects(
      createPostgresServerStores({
        connectionString,
        mode:"production",
        migrationId:"missing-migration",
        snapshotFingerprint:fingerprint,
      }),
      /postgres_validated_migration_missing/
    );
  } finally {
    await setup.query("DROP SCHEMA IF EXISTS bookedradar CASCADE");
    await setup.end();
  }
});
