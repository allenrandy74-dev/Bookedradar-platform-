import { useJsonMemoryView } from "../src/json-file-transaction.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import express from 'express';
import { validTwilioSignature } from '../src/warm-transfer.js';
import { isOptOutText, isSmsControlText } from '../src/intake.js';
import { RecoveryStore } from '../src/recovery/store.js';
import { RecoveryEngine } from '../src/recovery/engine.js';
import { generateSmsReply, smsConversationEnabled } from '../src/sms-conversation.js';
import { queueSmsReply, persistSmsReply } from '../src/sms-reply-queue.js';

// Register the exact production route with synthetic dependencies; do not boot
// server.js startup tasks, load real credentials or contact external providers.
test('signed inbound HTTP webhook queues once, rejects impostors and preserves STOP/HELP',async()=>{
  const source=await fs.readFile(new URL('../server.js',import.meta.url),'utf8');
  const route=source.slice(source.indexOf('app.post("/twilio/sms"'),source.indexOf('app.get("/api/v1/actions/due"'));
  const raw=new RecoveryStore('/tmp/sms-webhook-unused.json');useJsonMemoryView(raw);raw.persist=async()=>{};
  const tenant={tenantId:'synthetic',commercial:{dispatchMode:'live'},features:{twoWaySms:true},integrations:{sms:{enabled:true,type:'twilio',accountSid:'AC'+'1'.repeat(32),authToken:'synthetic-only',fromNumber:'+14095550101'}}};
  const engine=new RecoveryEngine({store:raw,tenant});let serial=Promise.resolve(),generated=0,sends=0;
  const store={tenantId:'synthetic',getContact:key=>raw.getContact(key),smsReplyQueued:async sid=>raw.hasEventKey(`sms-reply:synthetic:${sid}`, "synthetic"),queueSmsReplyOnce(req,t){const next=serial.then(()=>persistSmsReply(raw,t,req));serial=next.catch(()=>{});return next;}};
  const app=express(),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${server.address().port}`,url=base+'/twilio/sms?tenant=synthetic';
  const prior=process.env.DISPATCH_ENABLED;process.env.DISPATCH_ENABLED='true';
  const deps={app,express,registry:{get:id=>id===tenant.tenantId?tenant:null},tenantSecret:()=>'',SMS_PUBLIC_BASE_URL:base,VOICE_PUBLIC_BASE_URL:'',validTwilioSignature,isOptOutText,isSmsControlText,engineFor:()=>engine,
    latestOpenOpportunityForContact:async(t,k)=>Object.values(raw.data.opportunities).find(o=>o.tenantId===t&&o.contactKey===k&&o.status!=='closed'),
    dispatcherFor:()=>({adapters:{sms:{send:async()=>{sends++;throw Error('direct send forbidden');}}}}),smsConversationEnabled,
    recoveryStore:{forTenant:id=>id===tenant.tenantId?store:null},openai:{responses:{create:async()=>{generated++;return {output_text:'The team will confirm your preferred time.'};}}},SMS_RESPONSE_MODEL:'synthetic',generateSmsReply,queueSmsReply,maskPhone:()=>'',console:{log(){},error(){}}};
  new Function('deps',`const {${Object.keys(deps).join(',')}}=deps;\n${route}`)(deps);
  async function post(text,sid='SM'+'a'.repeat(32),extra={},valid=true){const body={AccountSid:tenant.integrations.sms.accountSid,To:tenant.integrations.sms.fromNumber,From:'+14095550100',Body:text,MessageSid:sid,...extra};let payload=url;for(const key of Object.keys(body).sort())payload+=key+body[key];const signature=crypto.createHmac('sha1','synthetic-only').update(payload).digest('base64');return fetch(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','X-Twilio-Signature':valid?signature:'invalid'},body:new URLSearchParams(body)});}
  try{
    assert.equal((await post('hello',undefined,{},false)).status,403);
    assert.equal((await post('hello',undefined,{AccountSid:'wrong'})).status,403);
    assert.equal((await post('hello',undefined,{To:'+14095550199'})).status,403);
    assert.equal(generated,0);
    assert.equal((await post('Can you come tomorrow?')).status,200);
    assert.equal((await post('Can you come tomorrow?')).status,200);
    assert.equal(generated,1);assert.equal(sends,0);
    const replies=Object.values(raw.data.actions).filter(a=>a.template==='inbound_sms_reply');
    assert.equal(replies.length,1);assert.equal(replies[0].status,'pending');
    await raw.patchAction(replies[0].id,{status:'completed'});
    assert.equal((await post('Can you come tomorrow?')).status,200);
    assert.equal(raw.data.actions[replies[0].id].status,'completed');assert.equal(generated,1);
    const enqueue=store.queueSmsReplyOnce.bind(store);let failEnqueue=true;
    store.queueSmsReplyOnce=(...args)=>{if(failEnqueue){failEnqueue=false;throw new Error('synthetic commit failure');}return enqueue(...args);};
    assert.equal((await post('A second question','SM'+'e'.repeat(32))).status,503);
    assert.equal((await post('A second question','SM'+'e'.repeat(32))).status,200);
    const recoveredReply=Object.values(raw.data.actions).filter(a=>a.sourceMessageSid==='SM'+'e'.repeat(32));
    assert.equal(recoveredReply.length,1);assert.equal(recoveredReply[0].status,'pending');
    const generatedBeforeControl=generated;
    process.env.DISPATCH_ENABLED='false';
    assert.equal((await post('HELP','SM'+'b'.repeat(32))).status,200);assert.equal(generated,generatedBeforeControl);
    assert.equal((await post('STOP','SM'+'c'.repeat(32))).status,200);
    assert.equal((await raw.getContact('synthetic:+14095550100')).suppressed,true);
    process.env.DISPATCH_ENABLED='true';
    assert.equal((await post('hello again','SM'+'d'.repeat(32))).status,200);assert.equal(generated,generatedBeforeControl);assert.equal(sends,0);
  }finally{if(prior===undefined)delete process.env.DISPATCH_ENABLED;else process.env.DISPATCH_ENABLED=prior;server.closeAllConnections();await new Promise(r=>server.close(r));}
});
