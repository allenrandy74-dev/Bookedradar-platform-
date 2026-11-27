import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { Pool } from "pg";
import { applyPostgresSchema } from "../src/postgres-runtime.js";
import { PostgresOpsIncidentStore, buildOpsAlertCandidate, sendOpsAlertEmail } from "../src/ops-alerting.js";

const connectionString=process.env.POSTGRES_TEST_URL;

test("real Postgres 18: alert retries stay identical and cooldown reminders send separately", {skip:!connectionString}, async()=>{
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
    const first = one.notification || two.notification;

    const row=await pool.query(
      "SELECT status,occurrences,last_notified_at FROM bookedradar.ops_incidents WHERE incident_key=$1",
      [candidate.incidentKey]
    );
    assert.equal(row.rows[0].status,"active");
    assert.equal(Number(row.rows[0].occurrences),2);
    assert.equal(row.rows[0].last_notified_at,null);
    assert.equal(Object.hasOwn((await a.active())[0].payload, "notification"), false);

    const accepted = new Map();
    let loseResponse = true;
    const fetchImpl = async (_url, request) => {
      const key = request.headers["Idempotency-Key"];
      if (accepted.has(key) && accepted.get(key) !== request.body) {
        return { ok: false, status: 409, text: async () => "synthetic idempotency conflict" };
      }
      accepted.set(key, request.body);
      if (loseResponse) {
        loseResponse = false;
        throw new Error("synthetic connection loss after provider acceptance");
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: key }) };
    };
    const send = notification => sendOpsAlertEmail({
      apiKey: "synthetic-test", from:"ops@example.com", to:"owner@example.com", notification, fetchImpl,
    });
    const expireLease = () => pool.query(
      `UPDATE bookedradar.ops_incidents
          SET payload=jsonb_set(payload,'{notification,claimUntil}',to_jsonb(now()-interval '1 minute'))
        WHERE incident_key=$1`, [candidate.incidentKey]
    );
    await assert.rejects(send(first), /synthetic connection loss/);
    assert.equal(await a.releaseNotification(candidate.incidentKey, first.claimId), true);
    assert.equal(await a.completeNotification(candidate.incidentKey, first.claimId), false);
    assert.equal((await b.observe(candidate)).shouldNotify, false);
    await expireLease();

    const changed = { ...candidate, signals: [{ ...candidate.signals[0], count: 3 }] };
    const { notification: retry } = await b.observe(changed);
    assert.equal(retry.id, first.id);
    assert.deepEqual(retry.message, first.message);
    assert.match(retry.message.text, /transfer_failure: 1/);
    assert.doesNotMatch(retry.message.text, /synthetic/);
    assert.equal(await a.releaseNotification(candidate.incidentKey, first.claimId), false);
    assert.equal(await a.completeNotification(candidate.incidentKey, first.claimId), false);
    await send(retry);
    assert.equal(accepted.size, 1);

    // A healthy observation can race a successful provider acknowledgement.
    assert.equal((await a.resolveScope(candidate.scopeKey)).length, 1);
    assert.equal(await b.completeNotification(candidate.incidentKey, retry.claimId), true);

    const suppressed=await a.observe(candidate,{cooldownMinutes:30});
    assert.equal(suppressed.shouldNotify,false);

    await pool.query(
      "UPDATE bookedradar.ops_incidents SET last_notified_at=now()-interval '31 minutes' WHERE incident_key=$1",
      [candidate.incidentKey]
    );
    const { notification: reminder } = await a.observe(changed);
    assert.notEqual(reminder.id, first.id);
    assert.match(reminder.message.text, /transfer_failure: 3/);
    await send(reminder);
    assert.equal(accepted.size, 2);

    // Restarted workers keep a recent claim's key after the old worker dies.
    await expireLease();
    const { notification: restarted } = await b.observe(changed);
    assert.equal(restarted.id, reminder.id);
    await send(restarted);
    assert.equal(accepted.size, 2);

    // Beyond the safe retry window, start a new reminder with today's evidence.
    await expireLease();
    await pool.query(
      `UPDATE bookedradar.ops_incidents
          SET payload=jsonb_set(payload,'{notification,createdAt}',to_jsonb(now()-interval '24 hours'))
        WHERE incident_key=$1`, [candidate.incidentKey]
    );
    const { notification: nextReminder } = await a.observe(candidate);
    assert.notEqual(nextReminder.id, reminder.id);
    assert.equal(await b.completeNotification(candidate.incidentKey, restarted.claimId), false);
    await send(nextReminder);
    assert.equal(await a.completeNotification(candidate.incidentKey, nextReminder.claimId), true);
    assert.equal(accepted.size, 3);
    assert.equal((await a.resolveScope(candidate.scopeKey)).length, 1);
    assert.deepEqual(await a.active(), []);
  }finally{
    await pool.query("DROP SCHEMA IF EXISTS bookedradar CASCADE");
    await pool.end();
  }
});
