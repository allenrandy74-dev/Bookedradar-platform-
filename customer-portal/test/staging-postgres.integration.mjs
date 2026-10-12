import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {requireDisposablePostgres} from './disposable-postgres.mjs';
import {STAGING} from '../server/staging-config.mjs';
import {setupStagingSchema} from '../server/staging-schema-setup.mjs';
import {assertStagingSchemaReady} from '../server/staging-schema-readiness.mjs';
import {activateStagingOwner} from '../server/staging-bind-owner.mjs';
import {createStagingAuthStore} from '../server/staging-auth-store.mjs';
import {createPostgresPortalStore} from '../server/postgres-store.mjs';
import {createOpaqueSessionResolver} from '../server/session-resolver.mjs';
import {createStagingAuthService} from '../server/staging-auth.mjs';
import {createCustomerPortalService,API_PREFIX} from '../server/api.mjs';
const guarded=requireDisposablePostgres();const {Pool}=await import('pg');
const config={enabled:true,...STAGING},fingerprint='a'.repeat(64),hash=s=>createHash('sha256').update(s).digest('hex');
const cookies=r=>(r.headers['set-cookie']||[]).filter(s=>!s.includes('Max-Age=0')).map(s=>s.split(';')[0]).join('; ');
const defer=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
await test('staging auth against guarded disposable PostgreSQL 18, no Wix calls',{timeout:120000},async t=>{
  const actual=new Pool({connectionString:guarded.connectionString,max:10,connectionTimeoutMillis:3000});let created=false;
  const verifyActual=async()=>{const row=(await actual.query("SELECT current_database() AS name,current_setting('server_version_num')::int AS version")).rows[0];assert.equal(row.name,guarded.database);assert.ok(row.version>=180000);};
  await verifyActual();
  assert.equal((await actual.query("SELECT 1 FROM pg_namespace WHERE nspname='bookedradar_portal_staging'")).rowCount,0,'Never adopt or drop a preexisting staging schema');
  // Test-only metadata shim: actual host/database are separately guarded above.
  // This lets exact lab-gated SQL execute in *_portal_test, never in the real lab.
  // There is no equivalent override in any runtime module or environment setting.
  const wrapClient=client=>({query:(sql,args)=>sql==='SELECT current_database() AS name'?Promise.resolve({rows:[{name:STAGING.databaseName}]}):client.query(sql,args),release:broken=>client.release(broken)});
  const pool={query:(sql,args)=>sql==='SELECT current_database() AS name'?Promise.resolve({rows:[{name:STAGING.databaseName}]}):actual.query(sql,args),connect:async()=>wrapClient(await actual.connect())};
  t.after(async()=>{try{if(created){await verifyActual();await actual.query('DROP SCHEMA bookedradar_portal_staging CASCADE');}}finally{await actual.end();}});
  await t.test('failed migration rolls back all staging DDL and synthetic records',async()=>{
    let failed=false;
    const failingPool={query:pool.query,connect:async()=>{
      const client=await pool.connect();
      return {release:client.release,query:async(sql,args)=>{
        if(sql.startsWith('INSERT INTO bookedradar_portal_staging.schema_version')){
          failed=true;
          return client.query('SELECT 1/0'); // Real PostgreSQL transaction error after DDL and seed.
        }
        return client.query(sql,args);
      }};
    }};
    await assert.rejects(setupStagingSchema({config,pool:failingPool}),/division by zero/);
    assert.equal(failed,true);
    assert.equal((await actual.query("SELECT 1 FROM pg_namespace WHERE nspname='bookedradar_portal_staging'")).rowCount,0);
  });
  const firstSetup=await setupStagingSchema({config,pool});created=true;assert.equal(firstSetup.created,true);
  await assertStagingSchemaReady({config,pool});
  const storeA=createStagingAuthStore({config,pool}),storeB=createStagingAuthStore({config,pool});
  const portalStore=createPostgresPortalStore({pool,schema:STAGING.schema,stagingConfig:config});
  const resolveSession=createOpaqueSessionResolver({store:portalStore});
  let starts=[],verify=async()=>({fingerprint,expiresAt:new Date(Date.now()+3600000).toISOString()});
  const provider={loginUrl:async options=>{starts.push(options);return 'https://www.bookedradar.com/_api/oauth2/authorize';},verifyCode:input=>verify(input),logoutUrl:()=>'/api/auth/logout-callback'};
  const a=createStagingAuthService({config,store:storeA,provider,resolveSession}),b=createStagingAuthService({config,store:storeB,provider,resolveSession});
  const request=(service,method,path,body,cookie='',extra={})=>service({method,url:path,body,headers:{cookie,'sec-fetch-site':'same-origin',...(method==='POST'?{origin:STAGING.origin,'content-type':'application/json'}:{}),...extra}});
  const login=async(service=a,cookie='')=>{const response=await request(service,'GET','/api/auth/login',undefined,cookie);assert.equal(response.status,303);return {cookie:cookies(response),state:starts.at(-1).state};};
  const callback=(flow,service=b)=>request(service,'POST','/api/auth/callback',{code:'synthetic-code',state:flow.state},flow.cookie,{'x-login-csrf':flow.state});
  const activate=async()=>{const discovery=await callback(await login());assert.equal(discovery.status,403);await activateStagingOwner({config,pool,fingerprint,confirmationReference:'synthetic explicit test approval'});};
  const reset=async()=>{await actual.query('TRUNCATE bookedradar_portal_staging.audit_events,bookedradar_portal_staging.notes,bookedradar_portal_staging.sessions,bookedradar_portal_staging.identity_binding_audit,bookedradar_portal_staging.identity_bindings,bookedradar_portal_staging.login_discoveries,bookedradar_portal_staging.oauth_flows,bookedradar_portal_staging.login_browsers,bookedradar_portal_staging.auth_rate_limits');await actual.query('UPDATE bookedradar_portal_staging.tenants SET active=false');await actual.query('UPDATE bookedradar_portal_staging.memberships SET active=false');starts=[];verify=async()=>({fingerprint,expiresAt:new Date(Date.now()+3600000).toISOString()});};
  const run=(name,fn)=>t.test(name,async()=>{await reset();await fn();});
  await run('setup is advisory-serialized, idempotent and never reactivates/reseeds existing data',async()=>{
    const pair=await Promise.all([setupStagingSchema({config,pool}),setupStagingSchema({config,pool})]);assert.ok(pair.every(r=>r.created===false));
    assert.equal((await actual.query('SELECT count(*)::int AS count FROM bookedradar_portal_staging.memberships WHERE active')).rows[0].count,0);
    assert.equal((await actual.query('SELECT count(*)::int AS count FROM bookedradar_portal_staging.identity_bindings')).rows[0].count,0);
    assert.equal((await actual.query('SELECT count(*)::int AS count FROM bookedradar_portal_staging.inquiries')).rows[0].count,3);
  });
  await run('owner activation needs a fresh verified discovery and is fixed to one synthetic membership',async()=>{
    await assert.rejects(activateStagingOwner({config,pool,fingerprint,confirmationReference:'approved synthetic'}),/fresh_verified_sign_in_required/);
    await activate();assert.equal((await actual.query('SELECT count(*)::int AS count FROM bookedradar_portal_staging.identity_binding_audit')).rows[0].count,1);
    assert.equal((await actual.query("SELECT active FROM bookedradar_portal_staging.tenants WHERE id='portal-staging-other'")).rows[0].active,false);
    const response=await callback(await login());assert.equal(response.status,200);assert.equal((await resolveSession({headers:{cookie:cookies(response)}})).tenantId,'portal-staging-demo');
  });
  await run('concurrent cross-instance callback CAS exchanges once and replay never issues a second session',async()=>{
    await activate();let count=0;verify=async()=>{count++;return {fingerprint,expiresAt:new Date(Date.now()+3600000).toISOString()};};const flow=await login();const pair=await Promise.all([callback(flow,a),callback(flow,b)]);assert.deepEqual(pair.map(r=>r.status).sort(),[200,400]);assert.equal(count,1);assert.equal((await callback(flow)).status,400);
    assert.equal((await actual.query('SELECT count(*)::int AS count FROM bookedradar_portal_staging.sessions')).rows[0].count,1);
  });
  await run('consumed callback cannot issue after other-instance logout',async()=>{
    await activate();const entered=defer(),release=defer();verify=async()=>{entered.resolve();await release.promise;return {fingerprint,expiresAt:new Date(Date.now()+3600000).toISOString()};};const flow=await login();const pending=callback(flow,a);await entered.promise;assert.equal((await request(b,'POST','/api/auth/logout',{},flow.cookie)).status,200);release.resolve();const result=await pending;assert.equal(result.status,400);assert.equal(result.headers['set-cookie'],undefined);
    assert.equal((await actual.query('SELECT count(*)::int AS count FROM bookedradar_portal_staging.sessions')).rows[0].count,0);
  });
  await run('consumed callback cannot issue after newer other-instance login generation',async()=>{
    await activate();const entered=defer(),release=defer();verify=async()=>{entered.resolve();await release.promise;return {fingerprint,expiresAt:new Date(Date.now()+3600000).toISOString()};};const flow=await login();const pending=callback(flow,a);await entered.promise;const newer=await login(b,flow.cookie);release.resolve();assert.equal((await pending).status,400);verify=async()=>({fingerprint,expiresAt:new Date(Date.now()+3600000).toISOString()});assert.equal((await callback(newer)).status,200);
  });
  await run('late old cookie and completed logout are rejected across instances and workflow transaction',async()=>{
    await activate();const signed=await callback(await login());const oldCookie=cookies(signed),principal=await resolveSession({headers:{cookie:oldCookie}});assert.ok(principal);
    const admitted=createCustomerPortalService({store:portalStore,resolveSession:async()=>principal,allowedOrigins:[STAGING.origin]});
    const newer=await login(b,oldCookie);assert.equal(await resolveSession({headers:{cookie:oldCookie}}),null);
    assert.equal((await admitted({method:'PATCH',url:API_PREFIX+'/inquiries/synthetic-inquiry-1',headers:{origin:STAGING.origin,'content-type':'application/json','x-csrf-token':principal.csrfToken},body:{version:1,status:'closed'}})).status,401);
    const fresh=await callback(newer),freshCookie=cookies(fresh),freshSession=await resolveSession({headers:{cookie:freshCookie}});
    const loggedOut=await request(a,'POST','/api/auth/logout',{},freshCookie,{'x-csrf-token':freshSession.csrfToken});assert.equal(loggedOut.status,200);assert.equal(await resolveSession({headers:{cookie:freshCookie}}),null);
    assert.equal((await portalStore.getInquiry('portal-staging-demo','synthetic-inquiry-1')).version,1);
  });
  await run('binding revocation committed before write is rechecked with session in the transaction',async()=>{
    await activate();const signed=await callback(await login()),cookie=cookies(signed),principal=await resolveSession({headers:{cookie}});
    await actual.query('UPDATE bookedradar_portal_staging.identity_bindings SET active=false');
    const api=createCustomerPortalService({store:portalStore,resolveSession:async()=>principal,allowedOrigins:[STAGING.origin]});
    assert.equal((await api({method:'POST',url:API_PREFIX+'/inquiries/synthetic-inquiry-1/notes',headers:{origin:STAGING.origin,'content-type':'application/json','x-csrf-token':principal.csrfToken},body:{version:1,text:'Must not save'}})).status,401);
    assert.equal((await actual.query('SELECT count(*)::int AS count FROM bookedradar_portal_staging.notes')).rows[0].count,0);
  });
  await run('rotation CAS has one winner and preserves absolute expiry',async()=>{
    await activate();const signed=await callback(await login()),cookie=cookies(signed),before=await resolveSession({headers:{cookie}});const rotate=service=>request(service,'POST','/api/auth/rotate',{},cookie,{'x-csrf-token':before.csrfToken});
    const pair=await Promise.all([rotate(a),rotate(b)]);assert.deepEqual(pair.map(r=>r.status).sort(),[200,401]);assert.equal(await resolveSession({headers:{cookie}}),null);const after=await resolveSession({headers:{cookie:cookies(pair.find(r=>r.status===200))}});assert.equal(after.expiresAt,before.expiresAt);
  });
  await run('shared anonymous admission is limited before provider work',async()=>{
    let providerCalls=0;provider.loginUrl=async options=>{providerCalls++;starts.push(options);return 'https://www.bookedradar.com/_api/oauth2/authorize';};
    const statuses=[];for(let i=0;i<11;i++)statuses.push((await request(i%2?a:b,'GET','/api/auth/login')).status);
    assert.deepEqual(statuses,[303,303,303,303,303,303,303,303,303,303,429]);assert.equal(providerCalls,10);
    await actual.query("UPDATE bookedradar_portal_staging.auth_rate_limits SET minute_started=CURRENT_TIMESTAMP-INTERVAL '2 minutes',hour_attempts=60");assert.equal((await request(a,'GET','/api/auth/login')).status,429);
  });
  await run('readiness rejects changed columns and defaults without attempting repair',async()=>{
    for(const change of [
      'ALTER TABLE bookedradar_portal_staging.notes ALTER COLUMN text TYPE varchar(1999)',
      'ALTER TABLE bookedradar_portal_staging.memberships ALTER COLUMN active SET DEFAULT true',
      'ALTER TABLE bookedradar_portal_staging.sessions DROP CONSTRAINT sessions_verified_binding',
      'DROP INDEX bookedradar_portal_staging.inquiry_list_order',
      "CREATE FUNCTION bookedradar_portal_staging.unexpected_test_function() RETURNS integer LANGUAGE sql AS 'SELECT 1'",
    ]){
      const client=await actual.connect();try{
        await client.query('BEGIN');await client.query(change);
        const wrapped=wrapClient(client);const facade={query:wrapped.query,connect:async()=>{throw new Error('no nested connection');}};
        await assert.rejects(assertStagingSchemaReady({config,pool:facade}),/staging_schema_shape_mismatch/);
      }finally{await client.query('ROLLBACK');client.release();}
      await assertStagingSchemaReady({config,pool});
    }
  });
});
