import test from 'node:test';
import assert from 'node:assert/strict';
import {createPortalClient} from '../client.mjs';
const SESSION={userId:'u1',memberId:'m1',tenant:{id:'t1',name:'Demo'},role:'operator',canEdit:true};
const INQUIRY={id:'i1',version:1,status:'new'};
const response=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
const data=path=>path.endsWith('/session')?{ok:true,session:SESSION,csrfToken:'synthetic-csrf-only'}:path.endsWith('/inquiries')?{ok:true,inquiries:[INQUIRY],limit:100}:{ok:true,inquiry:INQUIRY};
const setup=(impl)=>{const calls=[];const client=createPortalClient({fetchImpl:async(path,options)=>{calls.push({path,options});return impl?impl(path,options):response(['PATCH','POST'].includes(options.method)?{ok:true,inquiry:{...INQUIRY,version:2}}:data(path));}});return{client,calls};};
test('client remains inactive until explicitly called and never sends tenant/admin headers',async()=>{const{client,calls}=setup();assert.equal(calls.length,0);await client.loadSession();await client.loadInquiries();assert.equal(calls.length,2);for(const c of calls){assert.equal(c.options.credentials,'same-origin');assert.equal(c.options.redirect,'error');assert.equal(c.options.cache,'no-store');assert.equal(c.options.headers.Authorization,undefined);assert.equal(c.options.headers['x-bookedradar-tenant'],undefined);assert.ok(c.path.startsWith('/api/customer-portal/v1/'));}});
test('session and fresh list are required before mutation',async()=>{const{client}=setup();await assert.rejects(client.updateInquiry('i1',{version:1,status:'closed'}),/session_required/);await client.loadSession();await assert.rejects(client.updateInquiry('i1',{version:1,status:'closed'}),/refresh_required/);});
test('writes transmit only authorized workflow fields, CSRF and optimistic version',async()=>{const{client,calls}=setup();await client.loadSession();await client.loadInquiries();await client.updateInquiry('i1',{version:1,status:'in_progress',tenantId:'evil'});const c=calls.at(-1);assert.equal(c.options.method,'PATCH');assert.deepEqual(JSON.parse(c.options.body),{version:1,status:'in_progress'});assert.equal(c.options.headers['X-CSRF-Token'],'synthetic-csrf-only');});
test('read-only sessions cannot mutate',async()=>{const{client}=setup(p=>response(p.endsWith('/session')?{ok:true,session:{...SESSION,role:'viewer',canEdit:false}}:data(p)));await client.loadSession();await client.loadInquiries();await assert.rejects(client.addNote('i1',{version:1,text:'x'}),/read_only/);});
test('unauthorized responses clear session and records',async()=>{let deny=false;const{client}=setup(p=>deny?response({ok:false},401):response(data(p)));await client.loadSession();await client.loadInquiries();deny=true;await assert.rejects(client.getInquiry('i1'),/session_unavailable/);assert.equal(client.state().session,null);assert.equal(client.state().snapshot,null);});
test('out-of-order list result cannot replace newer response',async()=>{let resolves=[];const{client}=setup(p=>p.endsWith('/session')?response(data(p)):new Promise(r=>resolves.push(r)));await client.loadSession();const a=client.loadInquiries(),aResult=assert.rejects(a,/superseded/);const b=client.loadInquiries();resolves[1](response({ok:true,inquiries:[{id:'new',version:1}],limit:100}));await b;resolves[0](response({ok:true,inquiries:[{id:'old',version:1}],limit:100}));await aResult;assert.equal(client.state().snapshot[0].id,'new');});
test('detail selection supersedes old result without leaking into new selection',async()=>{let resolves=[];const{client}=setup(p=>p.endsWith('/session')?response(data(p)):new Promise(r=>resolves.push(r)));await client.loadSession();const a=client.getInquiry('i1'),rejected=assert.rejects(a,/superseded/);const b=client.getInquiry('i2');resolves[1](response({ok:true,inquiry:{id:'i2',version:1}}));assert.equal((await b).id,'i2');resolves[0](response({ok:true,inquiry:{id:'i1',version:1}}));await rejected;});
test('version conflict is returned without retry or optimistic success',async()=>{const{client,calls}=setup((p,o)=>o.method==='PATCH'?response({ok:false,error:'version_conflict'},409):response(data(p)));await client.loadSession();await client.loadInquiries();await assert.rejects(client.updateInquiry('i1',{version:1,status:'closed'}),/version_conflict/);assert.equal(calls.filter(x=>x.options.method==='PATCH').length,1);assert.equal(client.state().snapshot[0].status,'new');});
test('repeated pending saves are rejected rather than duplicated',async()=>{let resolve;const{client,calls}=setup((p,o)=>o.method==='POST'?new Promise(r=>resolve=r):response(data(p)));await client.loadSession();await client.loadInquiries();const a=client.addNote('i1',{version:1,text:'x'});await assert.rejects(client.addNote('i1',{version:1,text:'x'}),/save_in_progress/);resolve(response({ok:true,inquiry:{id:'i1',version:2}}));await a;assert.equal(calls.filter(x=>x.options.method==='POST').length,1);});
test('session change fences an already in-flight mutation',async()=>{let resolve;const{client}=setup((p,o)=>o.method==='POST'?new Promise(r=>resolve=r):response(data(p)));await client.loadSession();await client.loadInquiries();const a=client.addNote('i1',{version:1,text:'x'}),rejected=assert.rejects(a,/superseded/);client.clear();resolve(response({ok:true,inquiry:{id:'i1',version:2}}));await rejected;assert.equal(client.state().snapshot,null);});
test('failed refresh clears old figures and invalid IDs are blocked before network',async()=>{let broken=false;const{client,calls}=setup(p=>broken?Promise.reject(new Error('private transport detail')):response(data(p)));await client.loadSession();await client.loadInquiries();await assert.rejects(client.getInquiry('../foreign'),/invalid_id/);assert.equal(calls.length,2);broken=true;await assert.rejects(client.loadInquiries(),/connection_failed/);assert.equal(client.state().snapshot,null);});
test('mutations fence old detail reads and block list/detail refresh during save',async()=>{
  let detailResolve,writeResolve;
  const{client}=setup((p,o)=>o.method==='PATCH'?new Promise(r=>writeResolve=r):p.endsWith('/i1')?new Promise(r=>detailResolve=r):response(data(p)));
  await client.loadSession();await client.loadInquiries();
  const old=client.getInquiry('i1'),oldRejected=assert.rejects(old,/superseded/);
  const write=client.updateInquiry('i1',{version:1,status:'in_progress'});
  await assert.rejects(client.loadInquiries(),/save_in_progress/);await assert.rejects(client.getInquiry('i1'),/save_in_progress/);
  writeResolve(response({ok:true,inquiry:{id:'i1',version:2,status:'in_progress'}}));await write;
  detailResolve(response({ok:true,inquiry:{id:'i1',version:1,status:'new'}}));await oldRejected;
  assert.equal(client.state().snapshot[0].version,2);
});
test('older server lists/details cannot regress a known saved revision',async()=>{
  const{client}=setup((p,o)=>o.method==='PATCH'?response({ok:true,inquiry:{...INQUIRY,version:2,status:'in_progress'}}):response(data(p)));
  await client.loadSession();await client.loadInquiries();await client.updateInquiry('i1',{version:1,status:'in_progress'});
  await assert.rejects(client.getInquiry('i1'),/stale_response/);assert.equal(client.state().stale,true);
  await assert.rejects(client.loadInquiries(),/stale_response/);assert.equal(client.state().snapshot,null);
});
test('conflict requires an explicit fresh snapshot before any further write',async()=>{
  const{client}=setup((p,o)=>o.method==='PATCH'?response({ok:false,error:'version_conflict'},409):response(data(p)));
  await client.loadSession();await client.loadInquiries();await assert.rejects(client.updateInquiry('i1',{version:1,status:'in_progress'}),/version_conflict/);
  assert.equal(client.state().stale,true);await assert.rejects(client.addNote('i1',{version:1,text:'must wait'}),/refresh_required/);
});
test('unchanged or skipped mutation revision cannot be reported saved',async()=>{
  for(const nextVersion of [1,3])for(const operation of ['updateInquiry','addNote']){
    const{client}=setup((p,o)=>['PATCH','POST'].includes(o.method)?response({ok:true,inquiry:{...INQUIRY,version:nextVersion}}):response(data(p)));
    await client.loadSession();await client.loadInquiries();
    await assert.rejects(client[operation]('i1',{version:1,status:'closed',text:'x'}),/invalid_mutation_response/);
    assert.equal(client.state().stale,true);assert.equal(client.state().snapshot[0].version,1);
  }
});
test('uncertain network mutation requires reconciliation before any retry',async()=>{
  const{client,calls}=setup((p,o)=>o.method==='POST'?Promise.reject(new Error('connection lost after possible commit')):response(data(p)));
  await client.loadSession();await client.loadInquiries();await assert.rejects(client.addNote('i1',{version:1,text:'x'}),/connection_failed/);
  assert.equal(client.state().stale,true);await assert.rejects(client.addNote('i1',{version:1,text:'x'}),/refresh_required/);assert.equal(calls.filter(x=>x.options.method==='POST').length,1);
});
