import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createWixContact,createWixInquiryNotes,createWixFollowupTask} from '../src/wix.js';

const base={apiKey:'synthetic',siteId:'synthetic',contactId:'synthetic',retries:1,writeRetries:0};
async function write(kind,opts=base){
  if(kind==='contact')return createWixContact({...opts,lead:{name:'Synthetic',email:'synthetic@example.invalid'}});
  if(kind==='patch')return createWixContact({...opts,lead:{name:'Synthetic Person',email:'synthetic@example.invalid'}});
  if(kind==='notes')return createWixInquiryNotes({...opts,text:'Synthetic only'});
  return createWixFollowupTask({...opts,lead:{service_type:'Synthetic'}});
}
for(const status of [500,408,429])for(const kind of ['contact','patch','notes','task']){
  test(`signup override makes one ${kind} mutation attempt after ambiguous HTTP ${status}`,async(t)=>{
    let mutations=0;
    t.mock.method(globalThis,'fetch',async(_url,options={})=>{
      if(!options.method)return Response.json({contacts:kind==='patch'?[{id:'synthetic',revision:'1',name:{first:'Synthetic'}}]:[]});
      mutations++;return Response.json({error:'synthetic_post_write_failure'},{status});
    });
    await assert.rejects(write(kind),error=>error.status===status);
    assert.equal(mutations,1);
  });
}
for(const status of [500,408,429])test(`safe lookup still retries HTTP ${status} with mutation retries disabled`,async(t)=>{
  let gets=0,posts=0;
  t.mock.method(globalThis,'fetch',async(_url,options={})=>{
    if(!options.method){gets++;return gets===1?Response.json({error:'synthetic'},{status}):Response.json({contacts:[]});}
    posts++;return Response.json({contact:{id:'synthetic'}});
  });
  assert.equal((await write('contact')).contactId,'synthetic');
  assert.equal(gets,2);assert.equal(posts,1);
});
for(const kind of ['contact','patch','notes','task'])test(`shared default ${kind} retry behavior remains unchanged`,async(t)=>{
  let mutations=0;
  t.mock.method(globalThis,'fetch',async(_url,options={})=>{
    if(!options.method)return Response.json({contacts:kind==='patch'?[{id:'synthetic',revision:'1',name:{first:'Synthetic'}}]:[]});
    mutations++;if(mutations===1)return Response.json({error:'synthetic'},{status:500});
    return Response.json(kind==='contact'||kind==='patch'?{contact:{id:'synthetic'}}:kind==='notes'?{note:{id:'synthetic'}}:{task:{id:'synthetic'}});
  });
  const {writeRetries,...opts}=base;assert.equal((await write(kind,opts)).ok,true);assert.equal(mutations,2);
});
test('multi-chunk notes stop at first uncertain chunk without replay or later writes',async(t)=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return calls===1?Response.json({note:{id:'synthetic-first'}}):Response.json({error:'uncertain'},{status:500});});
  await assert.rejects(createWixInquiryNotes({...base,text:'X'.repeat(5000)}));assert.equal(calls,2);
});

test('actual signup handler pins writeRetries zero, preserves read retries, and holds uncertainty on replay',async(t)=>{
  const source=await fs.readFile(new URL('../server.js',import.meta.url),'utf8');
  const marker='routes.post("/api/v1/public/proof-pilot", createRateLimiter({ windowMs: 60_000, max: 8 }), async (req, res) => {';
  const start=source.indexOf(marker)+marker.length;assert.ok(start>=marker.length);
  const body=source.slice(start,source.indexOf('\n});',start));
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  for(const failingStage of ['contact','notes','task',null]){
    const receipts=new Set(),seen=[];let attempts=0;
    const adapter=stage=>async opts=>{seen.push({stage,opts});attempts++;assert.equal(opts.writeRetries,0);assert.equal(opts.retries,3);if(stage===failingStage)throw Error('synthetic uncertain result');return stage==='contact'?{ok:true,contactId:'synthetic'}:stage==='notes'?{ok:true,noteIds:['synthetic']}:{ok:true,taskId:'synthetic'};};
    const deps={normalizeProofPilotInquiry:()=>({ok:true,inquiry:{trade:'synthetic'}}),registry:{get:()=>({})},wixCredentialsForTenant:()=>({apiKey:'synthetic',siteId:'synthetic'}),proofPilotInquiryKey:()=> 'synthetic-key',state:{hasInquiryReceipt:async k=>receipts.has(k),markInquiryOnce:async k=>{if(receipts.has(k))return false;receipts.add(k);return true;},releaseWebhook:async k=>receipts.delete(k)},proofPilotLead:()=>({notes:'synthetic'}),createWixContact:adapter('contact'),createWixInquiryNotes:adapter('notes'),createWixFollowupTask:adapter('task'),proofPilotTaskLead:()=>({}),timeoutMs:8,retries:3,growthMetrics:{record:async()=>{}},console:{log(){},error(){}}};
    const handler=new AsyncFunction('req','res',...Object.keys(deps),body);
    const request=()=>handler({body:{}},{statusCode:200,status(n){this.statusCode=n;return this;},json(result){return{status:this.statusCode,...result};}},...Object.values(deps));
    assert.equal((await request()).status,failingStage?503:201);
    const before=attempts,result=await request();assert.equal(result.status,failingStage?409:200);assert.equal(attempts,before);assert.ok(receipts.has('synthetic-key'));
    if(!failingStage)assert.deepEqual(seen.map(x=>x.stage),['contact','notes','task']);
  }
});
