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

test("ops email contains no caller content and uses deterministic idempotency",async()=>{
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
    notificationId:"11111111-1111-4111-8111-111111111111",apiKey:"synthetic-key",from:"ops@example.com",to:"owner@example.com",
    candidate,incidentId:candidate.incidentKey,fetchImpl,
  });
  assert.equal(result.id,"email-1");
  const body=JSON.parse(request.options.body);
  assert.equal(body.to[0],"owner@example.com");
  assert.match(body.subject,/CRITICAL/);
  assert.equal(body.text.includes("lead_persistence_failure"),true);
  assert.equal(body.text.includes("do not include this free text"),false);
  assert.equal(request.options.headers["Idempotency-Key"],"bookedradar/ops/11111111-1111-4111-8111-111111111111");
});

test("ops alerts do not report acceptance without a verified provider receipt",async t=>{
  const candidate=buildOpsAlertCandidate({scopeKey:'tenant:synthetic',assessment:{status:'critical',signals:[{code:'transfer_failure',count:1}]}});
  for (const [name,body] of [['empty',''],['invalid JSON','invalid'],['missing receipt','{}'],['null receipt','{"id":null}'],['numeric receipt','{"id":123}'],['blank receipt','{"id":"  "}'],['object receipt','{"id":{}}']]) {
    await t.test(name,async()=>{
      let writes=0;
      await assert.rejects(sendOpsAlertEmail({notificationId:"11111111-1111-4111-8111-111111111111",apiKey:'synthetic',from:'ops@example.com',to:'owner@example.com',candidate,
        fetchImpl:async()=>{writes++;return {ok:true,status:200,text:async()=>body};}}),/ops_alert_email_acceptance_unverified/);
      assert.equal(writes,1);
    });
  }
  assert.deepEqual(await sendOpsAlertEmail({notificationId:"11111111-1111-4111-8111-111111111111",apiKey:'synthetic',from:'ops@example.com',to:'owner@example.com',candidate,
    fetchImpl:async()=>({ok:true,status:200,text:async()=>'{"id":" receipt-1 "}'})}),{accepted:true,id:'receipt-1'});
});


test("each claimed reminder has its own provider identity and missing claims cannot send",async()=>{
  const candidate=buildOpsAlertCandidate({scopeKey:'tenant:synthetic',assessment:{status:'critical',signals:[{code:'transfer_failure',count:1}]}});
  const sent=new Map(); let writes=0;
  const fetchImpl=async (_url,options)=>{
    writes++;
    const key=options.headers['Idempotency-Key'];
    const previous=sent.get(key);
    if(previous && previous.body !== options.body) return {ok:false,status:409,text:async()=>'synthetic conflict'};
    if(previous) return {ok:true,status:200,text:async()=>JSON.stringify({id:previous.id})};
    const id='synthetic-'+sent.size;sent.set(key,{id,body:options.body});
    return {ok:true,status:200,text:async()=>JSON.stringify({id})};
  };
  const common={apiKey:'synthetic',from:'ops@example.com',to:'owner@example.com',candidate,fetchImpl};
  await assert.rejects(sendOpsAlertEmail(common),/notification_claim_required/);
  assert.equal(writes,0);
  const first=await sendOpsAlertEmail({...common,notificationId:'11111111-1111-4111-8111-111111111111'});
  const replay=await sendOpsAlertEmail({...common,notificationId:'11111111-1111-4111-8111-111111111111'});
  assert.equal(replay.id,first.id);
  const reminder=await sendOpsAlertEmail({...common,candidate:{...candidate,summary:{...candidate.summary,callsStarted:10}},notificationId:'22222222-2222-4222-8222-222222222222'});
  assert.notEqual(reminder.id,first.id);
  assert.equal(sent.size,2);
});
