import { useJsonMemoryView } from "../src/json-file-transaction.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { JsonStateStore } from '../src/state-store.js';
import { PostgresWebhookStore } from '../src/postgres-state-store.js';

const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
async function fixture(version, options = {}) {
  const source = await fs.readFile(new URL('../server.js', import.meta.url), 'utf8');
  const marker = 'app.post("/api/v1/public/proof-pilot", createRateLimiter({ windowMs: 60_000, max: 8 }), async (req, res) => {';
  const start = source.indexOf(marker) + marker.length;
  assert.ok(start >= marker.length);
  const body = source.slice(start, source.indexOf('\n});', start));
  const receipts = options.receipts || new Set();
  let contactCalls = 0;
  const state = {
    hasInquiryReceipt: async id => {
      if (options.lookupFails) throw Error('lookup_unavailable');
      return receipts.has(id);
    },
    markWebhookOnce: async id => {
      if (options.claimFails) throw Error('claim_unavailable');
      if (options.failCompletion && id.endsWith(':completed')) throw Error('database_unavailable');
      if (receipts.has(id)) return false;
      receipts.add(id); return true;
    },
    releaseWebhook: async id => receipts.delete(id),
  };
  state.markInquiryOnce = state.markWebhookOnce;
  const deps = {
    normalizeProofPilotInquiry: () => ({ok:true,inquiry:{trade:'hvac'}}),
    registry: {get:()=>({})}, wixCredentialsForTenant:()=>({apiKey:'synthetic',siteId:'synthetic'}),
    proofPilotInquiryKey:()=> 'synthetic-inquiry', state,
    proofPilotLead:()=>{if(options.preProviderFails)throw Error('lead_prepare_failed');return {notes:'synthetic'};},
    createWixContact:async()=> { contactCalls++; return options.contact ? options.contact() : {ok:true,contactId:'synthetic-contact'}; },
    createWixInquiryNotes:async()=>{if(options.notes) return options.notes();return {ok:true,noteIds:['synthetic-note']};},
    createWixFollowupTask:async()=>{if(options.task) return options.task();return {ok:true,taskId:'synthetic-task'};},
    proofPilotTaskLead:()=>({}), timeoutMs:10,retries:0,
    growthMetrics:{record:async()=>{if(options.metricFails)throw Error('metrics_unavailable');}},
    console:{log(){},error(){}},
  };
  const handler = new AsyncFunction('req','res',...Object.keys(deps),body);
  return { receipts, get contactCalls(){return contactCalls;}, request:async()=>{
    const res={statusCode:200,status(n){this.statusCode=n;return this;},json(data){return {status:this.statusCode,...data};}};
    return handler({body:{}},res,...Object.values(deps));
  }};
}

test('candidate: duplicate while pending is unconfirmed; provider ambiguity requires review',async()=>{
  let rejectContact; const waiting = new Promise((_,reject)=>{rejectContact=reject;});
  const f=await fixture('candidate',{contact:()=>waiting});
  const first=f.request(); await new Promise(setImmediate);
  assert.deepEqual(await f.request(),{status:409,ok:false,error:'inquiry_capture_unconfirmed'});
  rejectContact(Error('provider_failed'));assert.equal((await first).status,503);assert.equal(f.receipts.size,1);
  assert.equal((await f.request()).status,409);assert.equal(f.contactCalls,1);
});
test('candidate: abandoned reservation never becomes unverified success',async()=>{
  const f=await fixture('candidate',{receipts:new Set(['synthetic-inquiry'])});
  assert.equal((await f.request()).status,409);assert.equal(f.contactCalls,0);
});
test('candidate: completed duplicate succeeds without another provider call, even when metrics fail',async()=>{
  const f=await fixture('candidate',{metricFails:true});assert.equal((await f.request()).status,201);
  assert.deepEqual(await f.request(),{status:200,ok:true,duplicate:true,message:'We already received this request.'});
  assert.equal(f.contactCalls,1);
});
test('candidate: completed CRM capture with unavailable receipt storage retains reservation for reconciliation',async()=>{
  const f=await fixture('candidate',{failCompletion:true});assert.equal((await f.request()).status,503);
  assert.equal(f.receipts.has('synthetic-inquiry'),true);assert.equal((await f.request()).status,409);assert.equal(f.contactCalls,1);
});
test('candidate: receipt reads are read-only and expire after 24h in both stores',async()=>{
  const store=new JsonStateStore('/unused');useJsonMemoryView(store);
  store.state.processedWebhooks={fresh:Date.now(),expired:Date.now()-25*3600000};
  assert.equal(await store.hasInquiryReceipt('fresh'),true);assert.equal(await store.hasInquiryReceipt('expired'),false);assert.equal(await store.hasInquiryReceipt('missing'),false);
  const calls=[];const pg=new PostgresWebhookStore({query:async(sql,args)=>{calls.push({sql,args});return {rows:args[0]==='fresh'?[{}]:[]};}});
  assert.equal(await pg.hasInquiryReceipt('fresh'),true);assert.equal(await pg.hasInquiryReceipt('missing'),false);
  assert.ok(calls.every(c=>c.sql.startsWith('SELECT')&&c.sql.includes("interval '24 hours'")));
});

test('candidate: expired JSON inquiry reservation is reclaimed without changing voice-webhook behavior',async()=>{
  const s=new JsonStateStore('/unused');useJsonMemoryView(s);s.persist=async()=>{};
  const old=Date.now()-25*3600000;
  s.state.processedWebhooks={inquiry:old,'inquiry:completed':old,'voice-old':old};
  assert.equal(await s.hasInquiryReceipt('inquiry:completed'),false);
  assert.equal(await s.markInquiryOnce('inquiry'),true);
  assert.equal(await s.markInquiryOnce('inquiry'),false);
  assert.equal(await s.markWebhookOnce('voice-old'),false);
  assert.equal(s.state.processedWebhooks['voice-old'],old);
  assert.equal(await s.markInquiryOnce('inquiry:completed'),true);
  assert.equal(await s.hasInquiryReceipt('inquiry:completed'),true);
});
test('candidate: preflight lookup/claim failures return friendly503 without provider calls or foreign-receipt release',async()=>{
  for(const flag of ['lookupFails','claimFails']) {
    const existing=new Set(['foreign-receipt']);
    const f=await fixture('candidate',{[flag]:true,receipts:existing});
    assert.deepEqual(await f.request(),{status:503,ok:false,error:'inquiry_capture_failed'});
    assert.equal(f.contactCalls,0);assert.equal(existing.has('foreign-receipt'),true);
  }
});
test('candidate: failure before provider attempt releases only owned claim',async()=>{
  const f=await fixture('candidate',{preProviderFails:true});
  assert.equal((await f.request()).status,503);assert.equal(f.receipts.size,0);assert.equal(f.contactCalls,0);
});
test('candidate: partial task write failures require reconciliation rather than another provider attempt',async()=>{
  for(const stage of ['task']) {
    let writes=0;
    const f=await fixture('candidate',{[stage]:async()=>{writes++;throw Error('timeout_after_possible_write');}});
    assert.equal((await f.request()).status,503);
    assert.equal(f.receipts.has('synthetic-inquiry'),true);
    assert.equal(f.receipts.has('synthetic-inquiry:completed'),false);
    assert.equal((await f.request()).status,409);assert.equal(writes,1);assert.equal(f.contactCalls,1);
  }
});
test('candidate: failed or unconfirmed task response never records completed capture',async()=>{
  for(const result of [{ok:false},{ok:true}]) {
    const f=await fixture('candidate',{task:async()=>result});
    assert.equal((await f.request()).status,503);assert.equal((await f.request()).status,409);
    assert.equal(f.receipts.has('synthetic-inquiry:completed'),false);
  }
});
