/** Test-only loopback harness. Never imported by a runtime or pointed at a remote service. */
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createCustomerPortalService,API_PREFIX} from '../server/api.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const clone=value=>structuredClone(value);
const CSRF='synthetic-browser-csrf-only-00000000000001';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const member=(id,tenantId,name,role='operator')=>({id,tenantId,name,role,active:true,userId:`user-${id}`});
const row=(id,tenantId,customerName,subject,status='new',assigneeId=null)=>({id,tenantId,customerName,subject,status,assigneeId,version:1,contact:{email:`${id}@example.test`,phone:'+1 202-555-0108'},source:'Synthetic phone inquiry',summary:'Fictional service inquiry for staging workflow tests. Please review the next step.',receivedAt:'2026-10-12T10:00:00Z',updatedAt:'2026-10-12T10:00:00Z',notes:[]});

export async function createStagingHarness() {
  const state={};
  function reset() {
    Object.assign(state,{authenticated:true,account:'a',viewer:false,failList:false,empty:false,sessionDelay:0,listDelay:0,memberDelay:0,logoutDelay:0,detailDelays:{},writeDelay:0,failWrite:false,uncertainCommit:false,logoutFail:false,requests:[],audits:[]});
    state.members=[member('owner','lab-a','Alex Lee'),member('sam','lab-a','Sam Patel'),member('viewer','lab-a','Read Only','viewer'),member('other','lab-b','Other owner'),member('owner-b','lab-b','Other account owner')];
    state.records=[row('inquiry-a','lab-a','Jamie Brooks','AC running, but not cooling'),row('inquiry-b','lab-a','Taylor Reed','Follow-up on heat pump estimate','waiting','sam'),row('inquiry-c','lab-a','Morgan Ellis','Thermostat appointment','closed','owner'),row('foreign-inquiry','lab-b','Other workspace customer','Never display this foreign record'),row('inquiry-a','lab-b','Account B customer','Same ID from account B')];
  }
  reset();
  let origin;
  const store={
    async getMember(tenantId,id){return clone(state.members.find(value=>value.tenantId===tenantId&&value.id===id));},
    async listMembers(tenantId){return clone(state.members.filter(value=>value.tenantId===tenantId));},
    async getInquiry(tenantId,id){return clone(state.records.find(value=>value.tenantId===tenantId&&value.id===id));},
    async listInquiries(tenantId,limit){if(state.failList)throw new Error('synthetic failure');return clone(state.empty?[]:state.records.filter(value=>value.tenantId===tenantId).slice(0,limit));},
    async transaction(tenantId,operation){
      const rows=clone(state.records),audits=[];
      const result=await operation({getMember:async id=>clone(state.members.find(value=>value.tenantId===tenantId&&value.id===id)),getInquiry:async id=>clone(rows.find(value=>value.tenantId===tenantId&&value.id===id)),saveInquiry:async value=>{const index=rows.findIndex(row=>row.id===value.id&&row.tenantId===tenantId);if(index<0)throw new Error('synthetic row missing');rows[index]=clone(value);},appendAudit:async value=>audits.push(clone(value))});
      state.records=rows;state.audits.push(...audits);return result;
    }
  };
  const service=createCustomerPortalService({store,allowedOrigins:[],resolveSession:async()=>null});
  let handler=service;
  const assets=new Map([['staging-app.mjs','text/javascript'],['client.mjs','text/javascript'],['styles.css','text/css'],['staging-styles.css','text/css']]);
  const server=createServer(async(req,res)=>{
    try {
      const pathname=new URL(req.url,origin).pathname;
      if(pathname.startsWith('/api/')) {
        const chunks=[];for await(const chunk of req)chunks.push(chunk);
        const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')):undefined;
        state.requests.push({path:pathname,method:req.method,headers:clone(req.headers),body});
        const reply=(status,payload)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(payload));};
        if(pathname==='/api/auth/logout') {
          await wait(state.logoutDelay);
          if(state.logoutFail)return reply(503,{ok:false,error:'unavailable'});
          if(req.method!=='POST'||req.headers.origin!==origin||req.headers['x-csrf-token']!==(state.account==='b'?CSRF+'-b':CSRF)||JSON.stringify(body)!=='{}')return reply(403,{ok:false,error:'csrf_failed'});
          state.authenticated=false;return reply(200,{ok:true,redirectUrl:null});
        }
        if(pathname==='/api/auth/login'){res.writeHead(200,{'content-type':'text/html'});return res.end('<h1>Synthetic login route</h1><p>No provider is contacted by this test harness.</p>');}
        if(pathname.endsWith('/session'))await wait(state.sessionDelay);
        else if(pathname===`${API_PREFIX}/inquiries`)await wait(state.listDelay);
        else if(pathname===`${API_PREFIX}/members`)await wait(state.memberDelay);
        else if(req.method==='GET')await wait(state.detailDelays[pathname.split('/').at(-1)]||0);
        if(['PATCH','POST'].includes(req.method)) {
          await wait(state.writeDelay);
          if(state.failWrite)return reply(503,{ok:false,error:'synthetic_write_failure'});
        }
        const result=await handler({method:req.method,url:req.url,headers:req.headers,body});
        if(state.uncertainCommit&&['PATCH','POST'].includes(req.method)&&result.status<300){state.uncertainCommit=false;return reply(503,{ok:false,error:'synthetic_response_lost'});}
        res.writeHead(result.status,result.headers);return res.end(JSON.stringify(result.body));
      }
      let file,type;
      if(pathname==='/portal'||pathname==='/portal/'){file='staging-index.html';type='text/html';}
      else if(pathname.startsWith('/portal/assets/')&&assets.has(pathname.slice('/portal/assets/'.length))){file=pathname.slice('/portal/assets/'.length);type=assets.get(file);}
      else{res.writeHead(404);return res.end('Not found');}
      res.writeHead(200,{'content-type':`${type}; charset=utf-8`,'cache-control':'no-store','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",'x-content-type-options':'nosniff'});
      res.end(await readFile(path.join(root,file)));
    } catch {if(!res.headersSent)res.writeHead(500);res.end('Synthetic harness error');}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  origin=`http://127.0.0.1:${server.address().port}`;
  handler=createCustomerPortalService({store,allowedOrigins:[origin],resolveSession:async()=>state.authenticated?{userId:state.account==='b'?'user-owner-b':state.viewer?'user-viewer':'user-owner',memberId:state.account==='b'?'owner-b':state.viewer?'viewer':'owner',tenantId:state.account==='b'?'lab-b':'lab-a',tenantName:state.account==='b'?'Account B · Lab':'Cedar & Pine · Lab',expiresAt:new Date(Date.now()+3600000).toISOString(),sessionHash:`synthetic-session-${state.account}`,csrfToken:state.account==='b'?CSRF+'-b':CSRF}:null});
  return {origin,state,reset,close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();})};
}
