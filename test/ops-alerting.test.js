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

test("ops email contains no caller content and uses per-notification idempotency",async()=>{
  let request;
  const fetchImpl=async(url,options)=>{
    request={url,options};
    return {ok:true,status:200,text:async()=>JSON.stringify({id:"email-1"})};
  };
  const candidate=buildOpsAlertCandidate({
    scopeKey:"tenant:demo-hvac",
    assessment:{
      status:"critical",severity:"critical",
      signals:[{code:"lead_persistence_failure",count:1,message:"do not include this free text"}],
    },
    summary:{callsStarted:3,leadPersistFailures:1},
  });
  const result=await sendOpsAlertEmail({
    apiKey:"synthetic-key",from:"ops@example.com",to:"owner@example.com",
    candidate,incidentId:candidate.incidentKey,notificationId:"2026-11-04T10:00:00.000Z",fetchImpl,
  });
  assert.equal(result.id,"email-1");
  const body=JSON.parse(request.options.body);
  assert.equal(body.to[0],"owner@example.com");
  assert.match(body.subject,/CRITICAL/);
  assert.equal(body.text.includes("lead_persistence_failure"),true);
  assert.equal(body.text.includes("do not include this free text"),false);
  assert.match(request.options.headers["Idempotency-Key"],/^bookedradar\/ops\/[a-f0-9]{64}$/);
});


test("same notification attempt keeps a stable Resend key; a later cooldown gets another key",async()=>{
  const keys=[];
  const fetchImpl=async(_url,options)=>{
    keys.push(options.headers["Idempotency-Key"]);
    return {ok:true,status:200,text:async()=>JSON.stringify({id:"email-mock"})};
  };
  const candidate=buildOpsAlertCandidate({
    scopeKey:"tenant:demo-hvac",
    assessment:{status:"critical",severity:"critical",signals:[{code:"transfer_failure",count:1}]},
    summary:{callsStarted:4},
  });
  const args={apiKey:"synthetic-key",from:"ops@example.com",to:"owner@example.com",candidate,incidentId:candidate.incidentKey,fetchImpl};
  await sendOpsAlertEmail({...args,notificationId:"2026-11-04T10:00:00.000Z"});
  await sendOpsAlertEmail({...args,notificationId:"2026-11-04T10:00:00.000Z"});
  await sendOpsAlertEmail({...args,notificationId:"2026-11-04T10:30:00.000Z"});
  assert.equal(keys.length,3);
  assert.equal(keys[0],keys[1]);
  assert.notEqual(keys[1],keys[2]);
});

test("ops alert rejects missing persisted notification attempt before touching provider",async()=>{
  let requested=false;
  const candidate=buildOpsAlertCandidate({
    scopeKey:"tenant:demo-hvac",
    assessment:{status:"critical",severity:"critical",signals:[{code:"transfer_failure",count:1}]},
  });
  await assert.rejects(sendOpsAlertEmail({
    apiKey:"synthetic-key",from:"ops@example.com",to:"owner@example.com",
    candidate,incidentId:candidate.incidentKey,fetchImpl:async()=>{requested=true;},
  }),/ops_alert_notification_id_required/);
  assert.equal(requested,false);
});
