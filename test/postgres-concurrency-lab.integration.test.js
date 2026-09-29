import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { Pool } from "pg";
import { applyPostgresSchema } from "../src/postgres-runtime.js";
import { PostgresCallStateStore } from "../src/postgres-state-store.js";
import { PostgresCallHistoryStore } from "../src/postgres-call-history.js";

const connectionString=process.env.POSTGRES_TEST_URL;
const tenants=["demo-hvac","demo-plumbing","demo-electrical","demo-roofing","demo-home-services"];

function percentile(values,p){
  const sorted=[...values].sort((a,b)=>a-b);
  return sorted[Math.min(sorted.length-1,Math.max(0,Math.ceil(sorted.length*p)-1))] || 0;
}

test("real Postgres 18: two app pools preserve 200 overlapping call workflows across five crafts", {skip:!connectionString,timeout:120000}, async()=>{
  const setup=new Pool({connectionString,max:2});
  const appA=new Pool({connectionString,max:5,application_name:"bookedradar-concurrency-a"});
  const appB=new Pool({connectionString,max:5,application_name:"bookedradar-concurrency-b"});
  try{
    await setup.query("DROP SCHEMA IF EXISTS bookedradar CASCADE");
    const schema=await fs.readFile(new URL("../db/postgres-schema.sql",import.meta.url),"utf8");
    await applyPostgresSchema(setup,schema);

    const calls=Array.from({length:200},(_,i)=>({
      callId:`pg-concurrent-${i}`,
      tenantId:tenants[i%tenants.length],
      marker:`marker-${i}`,
      pool:i%2===0?appA:appB,
      sequence:i,
    }));

    const durations=[];
    const run=async(call)=>{
      const state=new PostgresCallStateStore(call.pool,call.tenantId);
      const history=new PostgresCallHistoryStore(call.pool,call.tenantId);
      const started=performance.now();

      await Promise.all([
        state.patchCall(call.callId,{
          tenantId:call.tenantId,
          phase:"accepted",
          marker:call.marker,
          sequence:call.sequence,
        }),
        history.start(call.callId,{
          tenantId:call.tenantId,
          callerMasked:`***${String(call.sequence).padStart(4,"0")}`,
          dialedMasked:"***PRIVATE",
        }),
      ]);
      await Promise.all([
        state.patchCall(call.callId,{phase:"sideband_open"}),
        history.addTurn(call.callId,{
          speaker:"caller",
          text:`synthetic private concurrency marker ${call.marker}`,
          itemId:`caller-${call.sequence}`,
        }),
      ]);
      await history.mark(call.callId,"call.accepted",{latencyMs:25+(call.sequence%10)});
      await history.addTurn(call.callId,{
        speaker:"assistant",
        text:`synthetic response ${call.marker}`,
        itemId:`assistant-${call.sequence}`,
      });
      await history.finish(call.callId,{
        transferred:call.sequence%11===0,
        leadSummary:{
          serviceType:"synthetic_concurrency",
          callback:"+14095550000",
          urgency:"test",
          preferredWindow:"test",
        },
      });
      durations.push(performance.now()-started);
    };

    const started=performance.now();
    await Promise.all(calls.map(run));
    const elapsedMs=performance.now()-started;

    const stateCount=await setup.query("SELECT count(*)::int AS count FROM bookedradar.call_control_state");
    const historyCount=await setup.query("SELECT count(*)::int AS count FROM bookedradar.voice_calls");
    const turnCount=await setup.query("SELECT count(*)::int AS count FROM bookedradar.call_turns");
    assert.equal(stateCount.rows[0].count,200);
    assert.equal(historyCount.rows[0].count,200);
    assert.equal(turnCount.rows[0].count,400);

    for(const tenantId of tenants){
      const count=await setup.query(
        "SELECT count(*)::int AS count FROM bookedradar.voice_calls WHERE tenant_id=$1",
        [tenantId]
      );
      assert.equal(count.rows[0].count,40);
    }

    for(const call of calls){
      const state=new PostgresCallStateStore(call.pool,call.tenantId);
      const history=new PostgresCallHistoryStore(call.pool,call.tenantId);
      const [stored,record]=await Promise.all([
        state.getCall(call.callId),
        history.get(call.callId),
      ]);
      assert.equal(stored.marker,call.marker);
      assert.equal(stored.phase,"sideband_open");
      assert.equal(record.tenantId,call.tenantId);
      assert.equal(record.transcript.length,2);
      assert.equal(record.transcript[0].text,`synthetic private concurrency marker ${call.marker}`);
      assert.equal(record.transcript[1].text,`synthetic response ${call.marker}`);
      assert.ok(record.endedAt);
    }

    const summary={
      workflows:200,
      appPools:2,
      connectionsPerPool:5,
      elapsedMs:Math.round(elapsedMs),
      workflowLatencyMs:{
        p50:Math.round(percentile(durations,0.50)),
        p95:Math.round(percentile(durations,0.95)),
        max:Math.round(Math.max(...durations)),
      },
      rows:{
        callState:stateCount.rows[0].count,
        voiceCalls:historyCount.rows[0].count,
        turns:turnCount.rows[0].count,
      },
    };
    console.log("POSTGRES_CONCURRENCY_LAB "+JSON.stringify(summary));
  }finally{
    await setup.query("DROP SCHEMA IF EXISTS bookedradar CASCADE");
    await Promise.all([appA.end(),appB.end(),setup.end()]);
  }
});
