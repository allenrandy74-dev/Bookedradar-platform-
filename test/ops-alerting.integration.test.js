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

    const claim=[one,two].find(x=>x.shouldNotify).notification;
    assert.ok(claim.notification_id);
    await a.acceptNotification(candidate.incidentKey,claim.notification_id,' receipt-first ');
    const resolved=await a.resolveScope("tenant:demo-hvac");
    assert.equal(resolved.length,1);
    const active=await a.active();
    assert.equal(active.length,0);

    // A verified reminder after cooldown gets a new persisted identity.
    await pool.query("UPDATE bookedradar.ops_incidents SET last_notified_at=now()-interval '2 hours' WHERE incident_key=$1",[candidate.incidentKey]);
    const reminder=await a.observe(candidate,{cooldownMinutes:30});
    assert.equal(reminder.shouldNotify,true);
    assert.notEqual(reminder.notification.notification_id,claim.notification_id);
    // A crash/in-flight claim still blocks after cooldown, restart and recovery.
    await pool.query("UPDATE bookedradar.ops_incidents SET last_notified_at=now()-interval '2 hours' WHERE incident_key=$1",[candidate.incidentKey]);
    assert.equal((await b.observe(candidate,{cooldownMinutes:30})).shouldNotify,false);
    await a.holdNotification(candidate.incidentKey,reminder.notification.notification_id);
    await a.resolveScope(candidate.scopeKey);
    assert.equal((await b.active())[0].notification_state,'uncertain');
    assert.equal((await b.observe(candidate,{cooldownMinutes:30})).shouldNotify,false);
    // Stale/unverified release must not clear an uncertain hold.
    assert.equal(await a.releaseNotification(candidate.incidentKey,reminder.notification.notification_id),false);
    assert.equal(await a.releaseNotification(candidate.incidentKey,claim.notification_id),false);
    assert.equal((await b.observe(candidate,{cooldownMinutes:30})).shouldNotify,false);

    const other={...candidate,incidentKey:candidate.incidentKey+'other',scopeKey:'tenant:other'};
    const unused=await b.observe(other);
    assert.equal(unused.shouldNotify,true);
    assert.equal(await b.releaseNotification(other.incidentKey,unused.notification.notification_id),true);
    const retry=await b.observe(other);
    assert.equal(retry.shouldNotify,true);
    await assert.rejects(b.acceptNotification(other.incidentKey,retry.notification.notification_id,' '),/acceptance_unverified/);
    await assert.rejects(b.acceptNotification(other.incidentKey,unused.notification.notification_id,'old'),/claim_lost/);
    await b.acceptNotification(other.incidentKey,retry.notification.notification_id,'accepted-other');
    const rows=await pool.query('SELECT state,provider_receipt FROM bookedradar.ops_notifications WHERE incident_key=$1 ORDER BY created_at',[other.incidentKey]);
    assert.deepEqual(rows.rows.map(x=>x.state),['not_sent','accepted']);
    assert.equal(rows.rows[1].provider_receipt,'accepted-other');
  }finally{
    await pool.query("DROP SCHEMA IF EXISTS bookedradar CASCADE");
    await pool.end();
  }
});
