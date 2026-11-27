import test from "node:test";
import assert from "node:assert/strict";
import { buildOpsAlertCandidate, sendOpsAlertEmail } from "../src/ops-alerting.js";

test("critical voice defects alert immediately",()=>{
  const candidate=buildOpsAlertCandidate({
    scopeKey:"tenant:demo-hvac",
    assessment:{
      status:"critical",severity:"critical",
      signals:[{code:"ended_without_first_audio",count:1,message:"silent"}],
    },
    summary:{callsStarted:4,callsEndedWithoutFirstAudio:1},
  });
  assert.equal(candidate.severity,"critical");
  assert.equal(candidate.signals[0].code,"ended_without_first_audio");
  assert.match(candidate.incidentKey,/^ops_[a-f0-9]{32}$/);
});

test("one-off warning noise is suppressed but clustered warning conditions alert",()=>{
  assert.equal(buildOpsAlertCandidate({
    scopeKey:"tenant:demo-hvac",
    assessment:{
      status:"attention",severity:"warning",
      signals:[{code:"realtime_error",count:1,message:"provider noise"}],
    },
    summary:{callsStarted:5},
  }),null);

  const clustered=buildOpsAlertCandidate({
    scopeKey:"tenant:demo-hvac",
    assessment:{
      status:"attention",severity:"warning",
      signals:[
        {code:"realtime_error",count:2,message:"provider noise"},
        {code:"crm_sync_failure",count:1,message:"crm"},
      ],
    },
    summary:{callsStarted:8,crmSyncFailures:1},
  });
  assert.equal(clustered.severity,"warning");
  assert.deepEqual(clustered.signals.map(x=>x.code),["crm_sync_failure","realtime_error"]);
});

test("healthy and no-data assessments do not create incidents",()=>{
  assert.equal(buildOpsAlertCandidate({scopeKey:"tenant:x",assessment:{status:"healthy",signals:[]}}),null);
  assert.equal(buildOpsAlertCandidate({scopeKey:"tenant:x",assessment:{status:"no_data",signals:[]}}),null);
});

test("ops email uses the notification ID and keeps the snapshotted request on retry",async()=>{
  const requests = [];
  const fetchImpl = async (_url, options) => {
    requests.push({ key: options.headers["Idempotency-Key"], body: options.body });
    return { ok: true, status: 200, text: async () => JSON.stringify({ id: "email-1" }) };
  };
  const notification = { id: "notification-1", message: { subject: "Critical incident", text: "Known signal" } };
  const send = (attempt) => sendOpsAlertEmail({
    apiKey:"synthetic-key",from:"ops@example.com",to:"owner@example.com",
    notification: attempt, fetchImpl,
  });
  assert.equal((await send(notification)).id, "email-1");
  await send({ ...notification, claimId: "reclaimed" });
  await send({ ...notification, id: "notification-2" });
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(requests[0].key, "bookedradar/ops/notification-1");
  assert.equal(requests[2].key, "bookedradar/ops/notification-2");
  assert.deepEqual(JSON.parse(requests[0].body), {
    from: "ops@example.com", to: ["owner@example.com"], ...notification.message,
  });
});
