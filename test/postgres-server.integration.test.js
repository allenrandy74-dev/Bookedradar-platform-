import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Pool } from 'pg';
import { createPostgresServerStores } from '../src/postgres-server-stores.js';

const connectionString=process.env.POSTGRES_TEST_URL;
test('real application HTTP routes use disposable Postgres with providers disabled',{skip:!connectionString},async()=>{
  const url=new URL(connectionString);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));assert.equal(url.pathname,'/bookedradar_test');
  const pool=new Pool({connectionString});const root=await fs.mkdtemp(path.join(os.tmpdir(),'br-server-pg-'));let child;let stores;
  try {
    await pool.query('DROP SCHEMA IF EXISTS bookedradar CASCADE');await pool.query(await fs.readFile(new URL('../db/postgres-schema.sql',import.meta.url),'utf8'));
    stores=await createPostgresServerStores({connectionString});
    await stores.state.patchCall('http-call',{tenantId:'demo-hvac',lastLead:{name:'Synthetic'}});
    await stores.callHistory.start('http-call',{tenantId:'demo-hvac'});
    await stores.callHistory.addTurn('http-call',{text:'Synthetic HTTP test'});
    const env={PATH:process.env.PATH,PORT:'0',DOTENV_CONFIG_PATH:path.join(root,'absent.env'),BOOKEDRADAR_STORAGE_BACKEND:'postgres_lab',DATABASE_URL:connectionString,BOOKEDRADAR_ADMIN_TOKEN:'synthetic-admin',BOOKEDRADAR_INGEST_TOKEN:'synthetic-ingest',VOICE_ENABLED:'false',DISPATCH_ENABLED:'false',BOOKEDRADAR_BILLING_ENABLED:'false',DEMO_NUMBER_PROVISION_MODE:'off',POSTGRES_HEALTH_ON_STARTUP:'false'};
    for(const key of ['STATE_FILE','RECOVERY_STATE_FILE','LEADS_FILE','CALL_HISTORY_FILE','WEB_CHAT_STATE_FILE','GROWTH_METRICS_FILE','BILLING_STATE_FILE'])env[key]=path.join(root,key+'.json');
    // A harmless preload observes the actual ephemeral port; no network mocking.
    const preload=path.join(root,'port.cjs');
    await fs.writeFile(preload,"const http=require('node:http');const original=http.Server.prototype.listen;http.Server.prototype.listen=function(...args){this.once('listening',()=>console.log('LAB_PORT='+this.address().port));return original.apply(this,args)};");
    child=spawn(process.execPath,['--require',preload,'server.js'],{cwd:new URL('..',import.meta.url),env,stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{output+=chunk;});
    let port;
    for(let i=0;i<100;i++){port=output.match(/LAB_PORT=(\d+)/)?.[1];if(port)break;if(child.exitCode!==null)throw new Error('application_start_failed: '+output.slice(-1200));await new Promise(r=>setTimeout(r,50));}
    assert.ok(port,'application started');
    const base=`http://127.0.0.1:${port}`;
    const headers={authorization:'Bearer synthetic-admin','x-bookedradar-tenant':'demo-hvac','content-type':'application/json'};
    const health=await (await fetch(base+'/health')).json();assert.equal(health.storageBackend,'postgres_lab');assert.equal(health.voiceEnabled,false);
    const ready=await(await fetch(base+'/ready',{headers})).json();assert.equal(ready.postgresShadow.authoritative,true);assert.ok(ready.tenants.every(t=>t.dispatchChannels.length===0));
    const event={id:'http-event',idempotencyKey:'http-event',type:'missed_call',contact:{name:'Synthetic',phone:'+14095550111',transactionalSmsAllowed:true}};
    const ingestHeaders={...headers,authorization:'Bearer synthetic-ingest'};
    const first=await fetch(base+'/api/v1/events',{method:'POST',headers:ingestHeaders,body:JSON.stringify(event)});assert.equal(first.status,201,await first.clone().text());
    const replay=await(await fetch(base+'/api/v1/events',{method:'POST',headers:ingestHeaders,body:JSON.stringify(event)})).json();assert.equal(replay.result.duplicate,true);
    const calls=await(await fetch(base+'/api/v1/calls',{headers})).json();assert.equal(calls.calls[0].callId,'http-call');
    assert.equal((await fetch(base+'/api/v1/calls/http-call',{headers:{...headers,'x-bookedradar-tenant':'demo-plumbing'}})).status,404);
    assert.equal((await fetch(base+'/api/v1/actions/reconciliation',{headers})).status,200);
    assert.equal((await fetch(base+'/api/v1/dispatch/run',{method:'POST',headers,body:'{}'})).status,409);
    assert.equal((await fetch(base+'/api/v1/public/growth-event',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({event:'page_view',trade:'hvac',source:'http-lab'})})).status,202);
    assert.equal((await stores.growth.summary()).counts['page_view|hvac|http-lab|default'],1);
    assert.equal((await stores.recovery.forTenant('demo-hvac').snapshot()).events.length,1);
    const loadStarted=Date.now();
    const loadResults=await Promise.all(Array.from({length:20},(_,i)=>fetch(base+'/api/v1/events',{method:'POST',headers:ingestHeaders,body:JSON.stringify({...event,id:`load-${i}`,idempotencyKey:`load-${i}`})})));
    for(const response of loadResults)assert.equal(response.status,201,await response.clone().text());
    assert.equal((await stores.recovery.forTenant('demo-hvac').snapshot()).events.length,21);
    assert.equal((await fetch(base+'/health')).status,200);
    console.log(JSON.stringify({event:'synthetic.storage_load',concurrentRequests:20,elapsedMs:Date.now()-loadStarted,allCommitted:true}));
    for(const key of ['STATE_FILE','RECOVERY_STATE_FILE','CALL_HISTORY_FILE','GROWTH_METRICS_FILE'])await assert.rejects(fs.stat(env[key]),{code:'ENOENT'});
  } finally {
    if(child && child.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),3000);await exited;clearTimeout(timer);}
    if(stores)await stores.close();await pool.query('DROP SCHEMA IF EXISTS bookedradar CASCADE');await pool.end();await fs.rm(root,{recursive:true,force:true});
  }
});
