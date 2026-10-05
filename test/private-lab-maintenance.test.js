import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {EventEmitter} from 'node:events';
import {pathToFileURL} from 'node:url';
import {labMaintenanceEnabled,validateLabMaintenanceEnvironment,main,LAB_NAME,LAB_DATABASE} from '../scripts/private-voice-lab-start.mjs';
const env = {PRIVATE_VOICE_LAB:'true',RENDER_SERVICE_NAME:LAB_NAME,
  DATABASE_URL:`postgresql://u:p@dpg-private-lab/${LAB_DATABASE}`,PRIVATE_VOICE_LAB_DATABASE_HOST:'dpg-private-lab',
  OPENAI_PROJECT_ID:'proj_O0Mk7nAzTfe0AIys8Ukwd1cn',PRIVATE_VOICE_LAB_MAINTENANCE:'true',
  VOICE_ENABLED:'false',DISPATCH_ENABLED:'false',BOOKEDRADAR_BILLING_ENABLED:'false',OPS_ALERTS_ENABLED:'false',
  WARM_TRANSFER_ENABLED:'false',DEMO_NUMBER_PROVISION_MODE:'off',PORT:'5050',
  RENDER_INSTANCE_ID:'maintenance-instance-test',RENDER_GIT_COMMIT:'a'.repeat(40)};

test('maintenance opt-in is literal and disabled by default',async()=>{
  assert.equal(labMaintenanceEnabled({}),false);
  assert.equal(labMaintenanceEnabled({PRIVATE_VOICE_LAB_MAINTENANCE:'false'}),false);
  assert.equal(labMaintenanceEnabled(env),true);
  for(const value of ['', 'TRUE', ' true ', '1', 'yes', 'FALSE', null, true, false]) {
    await assert.rejects(main({...env,PRIVATE_VOICE_LAB_MAINTENANCE:value}),/maintenance_flag_invalid/);
  }
});

test('maintenance retains exact lab identity and forbids unsafe integration settings',()=>{
  assert.equal(validateLabMaintenanceEnvironment(env),5050);
  for(const change of [{PRIVATE_VOICE_LAB:'false'},{RENDER_SERVICE_NAME:'bookedradar-platform'},
    {DATABASE_URL:'postgres://u:p@dpg-production/production'},{PRIVATE_VOICE_LAB_DATABASE_HOST:'dpg-other'},
    {DATABASE_URL:env.DATABASE_URL+'?host=production'}, {OPENAI_PROJECT_ID:'production'},
    {TWILIO_AUTH_TOKEN:'secret'},{DEMO_HVAC_WIX_API_KEY:'secret'},{RESEND_API_KEY:'secret'},
    {STRIPE_SECRET_KEY:'secret'},{DEMO_HVAC_HUMAN_TRANSFER_NUMBER:'+14095550100'}]) {
    assert.throws(()=>validateLabMaintenanceEnvironment({...env,...change}));
  }
  for(const key of ['VOICE_ENABLED','DISPATCH_ENABLED','BOOKEDRADAR_BILLING_ENABLED','OPS_ALERTS_ENABLED','WARM_TRANSFER_ENABLED']) {
    for(const value of [undefined,'','true','TRUE','False',' false ','0']) assert.throws(()=>validateLabMaintenanceEnvironment({...env,[key]:value}));
  }
  for(const key of ['POSTGRES_SHADOW_IMPORT_ON_STARTUP','POSTGRES_JSON_ROLLBACK_ON_STARTUP','POSTGRES_HEALTH_ON_STARTUP','CRM_SMOKE_TEST_ON_STARTUP','FUTURE_ACTION_ON_STARTUP']) {
    for(const value of ['true','TRUE','1','','false ']) assert.throws(()=>validateLabMaintenanceEnvironment({...env,[key]:value}));
    assert.equal(validateLabMaintenanceEnvironment({...env,[key]:'false'}),5050);
  }
  for(const value of [undefined,'','OFF','true']) assert.throws(()=>validateLabMaintenanceEnvironment({...env,DEMO_NUMBER_PROVISION_MODE:value}));
  for(const value of ['', '0','65536','123abc',' 5050','1.2']) assert.throws(()=>validateLabMaintenanceEnvironment({...env,PORT:value}),/port_invalid/);
});

test('copied entrypoint serves health only without app, config, dependencies or database access',async t=>{
  // An empty directory has no server.js, src/, config/, package.json or pg.
  // The syntactically valid database host is deliberately unreachable. Startup
  // must succeed without resolving/connecting to it or generating any files.
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'lab-maintenance-test-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const file=path.join(root,'private-voice-lab-start.mjs');
  await fs.copyFile(new URL('../scripts/private-voice-lab-start.mjs',import.meta.url),file);
  const isolated=await import(pathToFileURL(file).href);
  const realCreateServer=http.createServer;
  t.mock.method(http,'createServer',(...args)=>{
    const server=realCreateServer(...args),listen=server.listen;
    server.listen=function(port,host,callback){
      assert.equal(port,5050);assert.equal(host,'0.0.0.0');
      return listen.call(this,0,'127.0.0.1',callback);
    };
    return server;
  });
  const before={...env};
  const server=await isolated.main(env);
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url=`http://127.0.0.1:${server.address().port}`;
  for(const method of ['GET','HEAD']) {
    const response=await fetch(url+'/health',{method});
    assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
    if(method==='GET') assert.deepEqual(await response.json(),{status:'maintenance',mode:'private_lab_maintenance',
      customerReady:false,databaseReady:false,databaseAccess:'disabled',service:LAB_NAME,
      instanceId:env.RENDER_INSTANCE_ID,commit:env.RENDER_GIT_COMMIT});
    else assert.equal(await response.text(),'');
  }
  for(const [method,target] of [['GET','/'],['GET','/ready'],['GET','/health?ready=1'],['POST','/health'],['POST','/webhooks/openai'],['POST','/sms/inbound'],['OPTIONS','/health'],['GET','/anything']]) {
    const response=await fetch(url+target,{method});
    assert.equal(response.status,503,`${method} ${target}`);
    const body=await response.json();assert.equal(body.customerReady,false);assert.equal(body.databaseReady,false);
  }
  assert.deepEqual(env,before);
  assert.deepEqual(await fs.readdir(root),['private-voice-lab-start.mjs']);
  // Default/explicit-normal mode still takes the application preparation path.
  for(const flag of [undefined,'false']) {
    await assert.rejects(isolated.main({...env,PRIVATE_VOICE_LAB_MAINTENANCE:flag}),{code:'ENOENT'});
  }
});

test('maintenance listen failure rejects without reporting a healthy listener',async t=>{
  const messages=[];
  t.mock.method(console,'log',message=>messages.push(message));
  const server=new EventEmitter();
  server.listen=()=>{queueMicrotask(()=>server.emit('error',Object.assign(new Error('address in use'),{code:'EADDRINUSE'})));return server;};
  t.mock.method(http,'createServer',()=>server);
  await assert.rejects(main(env),{code:'EADDRINUSE'});
  assert.deepEqual(messages,[]);
  assert.notEqual(server.listening,true);
});
