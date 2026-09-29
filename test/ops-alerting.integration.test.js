import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { Pool } from "pg";
import { applyPostgresSchema } from "../src/postgres-runtime.js";
import { PostgresOpsIncidentStore, buildOpsAlertCandidate } from "../src/ops-alerting.js";

const connectionString=process.env.POSTGRES_TEST_URL;

test("real Postgres 18: concurrent app instances deduplicate the same incident notification", {skip:!connectionString}, async()=>{
  const pool=new Pool({connectionString});
  try{
    await pool.query("DROP SCHEMA IF EXISTS bookedradar CASCADE");
    const schema=await fs.readFile(new URL("../db/postgres-schema.sql",import.meta.url),"utf8");
    await applyPostgresSchema(pool,schema);

    const candidate=buildOpsAlertCandidate({
      scopeKey:"tenant:demo-hvac",
      assessment:{
        status:"critical",severity:"critical",
        signals:[{code:"transfer_failure",count:1,message:"synthetic"}],
      },
      summary:{callsStarted:4,transferFailures:1},
    });
    const a=new PostgresOpsIncidentStore(pool);
    const b=new PostgresOpsIncidentStore(pool);
    const [one,two]=await Promise.all([
      a.observe(candidate,{cooldownMinutes:30}),
      b.observe(candidate,{cooldownMinutes:30}),
    ]);
    assert.equal([one,two].filter(x=>x.shouldNotify).length,1);

    const row=await pool.query(
      "SELECT status,occurrences,last_notified_at FROM bookedradar.ops_incidents WHERE incident_key=$1",
      [candidate.incidentKey]
    );
    assert.equal(row.rows[0].status,"active");
    assert.equal(Number(row.rows[0].occurrences),2);
    assert.ok(row.rows[0].last_notified_at);

    const suppressed=await a.observe(candidate,{cooldownMinutes:30});
    assert.equal(suppressed.shouldNotify,false);

    const resolved=await a.resolveScope("tenant:demo-hvac");
    assert.equal(resolved.length,1);
    const active=await a.active();
    assert.equal(active.length,0);
  }finally{
    await pool.query("DROP SCHEMA IF EXISTS bookedradar CASCADE");
    await pool.end();
  }
});
