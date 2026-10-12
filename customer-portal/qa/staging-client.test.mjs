import test from 'node:test';
import assert from 'node:assert/strict';
import {createPortalClient,safeLogoutDestination} from '../client.mjs';
const SESSION={userId:'owner-user',memberId:'owner',tenant:{id:'lab',name:'Lab'},role:'operator',canEdit:true};
const CSRF='synthetic-test-only-csrf-value-000001';
const response=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
const session=()=>response({ok:true,session:SESSION,csrfToken:CSRF});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};

test('logout sends only same-origin JSON and private CSRF, then clears session',async()=>{
  const calls=[];
  const client=createPortalClient({fetchImpl:async(path,options)=>{calls.push({path,options});return path.endsWith('/session')?session():response({ok:true,redirectUrl:null});}});
  await client.loadSession();assert.deepEqual(await client.logout(),{redirectUrl:null});
  const {path,options}=calls.at(-1);assert.equal(path,'/api/auth/logout');assert.equal(options.method,'POST');assert.equal(options.credentials,'same-origin');assert.equal(options.headers['X-CSRF-Token'],CSRF);assert.equal(options.body,'{}');assert.equal(options.redirect,'error');
  assert.equal(client.state().session,null);assert.equal(client.state().snapshot,null);
});

test('logout fences pending list, members and detail even when server logout fails',async()=>{
  const list=deferred(),members=deferred(),detail=deferred(),logout=deferred();
  const pending={'/inquiries':list,'/members':members,'/inquiries/one':detail};
  const client=createPortalClient({fetchImpl:async(path)=>{
    if(path.endsWith('/session'))return session();
    if(path==='/api/auth/logout')return logout.promise;
    return pending[path.replace('/api/customer-portal/v1','')].promise;
  }});
  await client.loadSession();
  const listRead=assert.rejects(client.loadInquiries(),/superseded/),memberRead=assert.rejects(client.loadMembers(),/superseded/),detailRead=assert.rejects(client.getInquiry('one'),/superseded/);
  const out=assert.rejects(client.logout(),/unavailable/);
  list.resolve(response({ok:true,inquiries:[{id:'one',version:1}],limit:100}));members.resolve(response({ok:true,members:[{id:'owner',name:'Owner'}]}));detail.resolve(response({ok:true,inquiry:{id:'one',version:1}}));
  await Promise.all([listRead,memberRead,detailRead]);logout.resolve(response({ok:false,error:'unavailable'},503));await out;
  assert.equal(client.state().snapshot,null);assert.equal(client.state().stale,true);
  // An explicit sign-out retry remains possible, without exposing CSRF to the UI.
  assert.deepEqual(client.state().session,SESSION);
});

test('no logout request can overtake an in-flight mutation',async()=>{
  const save=deferred(),calls=[];
  const client=createPortalClient({fetchImpl:async(path,options)=>{
    calls.push(path);if(path.endsWith('/session'))return session();
    if(options.method==='POST')return save.promise;
    return response({ok:true,inquiries:[{id:'one',version:1}],limit:100});
  }});
  await client.loadSession();await client.loadInquiries();const saving=client.addNote('one',{version:1,text:'Example'});
  await assert.rejects(client.logout(),/save_in_progress/);assert.equal(calls.includes('/api/auth/logout'),false);
  save.resolve(response({ok:true,inquiry:{id:'one',version:2}}));await saving;
});


test('logout navigation is restricted to exact pilot provider and local callback',()=>{
  const origin='https://bookedradar-private-voice-lab-20260929.onrender.com';
  const valid='https://www.wixapis.com/_api/iam/authentication/v1/logout?clientId=f6191cf3-548f-4883-98a4-27cdd0fcff3a&postLogoutRedirectUri='+encodeURIComponent(origin+'/api/auth/logout-callback');
  assert.equal(safeLogoutDestination(valid,origin),valid);
  assert.equal(safeLogoutDestination('/api/auth/logout-callback',origin),origin+'/api/auth/logout-callback');
  for(const invalid of ['https://evil.example/logout','javascript:alert(1)',origin+'/portal',valid+'&extra=true',valid+'&clientId=duplicate',valid+'#fragment',valid.replace('www.wixapis.com','www.wixapis.com.evil.example'),valid.replace('https://','http://'),valid.replace('https://www.','https://user:pass@www.'),valid.replace('f6191','xxxxx'),valid.replace(encodeURIComponent(origin),encodeURIComponent('https://evil.example'))])assert.equal(safeLogoutDestination(invalid,origin),null,invalid);
});

test('every authenticated read carries the established session marker without browser tenant authority',async()=>{
  const calls=[];
  const client=createPortalClient({fetchImpl:async(path,options)=>{
    calls.push({path,options});if(path.endsWith('/session'))return session();
    if(path.endsWith('/members'))return response({ok:true,members:[]});
    if(path.endsWith('/inquiries'))return response({ok:true,inquiries:[{id:'same-id',version:1}],limit:100});
    return response({ok:true,inquiry:{id:'same-id',version:1}});
  }});
  await client.loadSession();await client.loadInquiries();await client.loadMembers();await client.getInquiry('same-id');
  assert.equal(calls[0].options.headers['X-CSRF-Token'],undefined);
  for(const call of calls.slice(1)){
    assert.equal(call.options.headers['X-CSRF-Token'],CSRF);
    assert.equal(call.options.headers.Authorization,undefined);
    assert.equal(Object.keys(call.options.headers).some(key=>key.toLowerCase().includes('tenant')),false);
  }
});

test('account A marker with account B cookie rejects same-ID data and clears all client state',async()=>{
  const {createCustomerPortalService}=await import('../server/api.mjs');
  let account='a';
  const members={a:{id:'member-a',tenantId:'tenant-a',userId:'user-a',name:'A',role:'operator',active:true},b:{id:'member-b',tenantId:'tenant-b',userId:'user-b',name:'B',role:'operator',active:true}};
  const record=tenantId=>({id:'same-id',tenantId,version:1,status:'new',assigneeId:null,customerName:tenantId==='tenant-a'?'Account A customer':'Account B customer',contact:{email:'synthetic@example.test',phone:''},subject:'Synthetic',summary:'Synthetic',source:'Test',receivedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),notes:[]});
  const service=createCustomerPortalService({allowedOrigins:['https://portal.example.test'],resolveSession:async()=>({userId:`user-${account}`,memberId:`member-${account}`,tenantId:`tenant-${account}`,tenantName:`Account ${account}`,expiresAt:new Date(Date.now()+60000).toISOString(),sessionHash:`hash-${account}`,csrfToken:account==='a'?CSRF:CSRF+'-b'}),store:{getMember:async(tenantId,id)=>Object.values(members).find(member=>member.tenantId===tenantId&&member.id===id),listMembers:async tenantId=>Object.values(members).filter(member=>member.tenantId===tenantId),getInquiry:async tenantId=>record(tenantId),listInquiries:async tenantId=>[record(tenantId)],transaction:async()=>{throw new Error('No write expected');}}});
  const client=createPortalClient({fetchImpl:async(url,options)=>{const result=await service({method:options.method,url,headers:options.headers});return response(result.body,result.status);}});
  await client.loadSession();await client.loadInquiries();assert.equal((await client.getInquiry('same-id')).customerName,'Account A customer');
  account='b';await assert.rejects(client.getInquiry('same-id'),error=>error.code==='session_unavailable'&&error.status===401);
  assert.equal(client.state().session,null);assert.equal(client.state().snapshot,null);
  await client.loadSession();assert.equal((await client.loadInquiries())[0].customerName,'Account B customer');
});

test('focus revalidation retains only the identical identity and session marker',async()=>{
  let next=SESSION,token=CSRF;
  const client=createPortalClient({fetchImpl:async()=>response({ok:true,session:next,csrfToken:token})});
  await client.loadSession();assert.deepEqual(await client.revalidateSession(),SESSION);
  token=CSRF+'-new';await assert.rejects(client.revalidateSession(),/session_unavailable/);assert.equal(client.state().session,null);
  token=CSRF;next=SESSION;await client.loadSession();next={...SESSION,tenant:{id:'other',name:'Other'}};
  await assert.rejects(client.revalidateSession(),/session_unavailable/);assert.equal(client.state().snapshot,null);
});
