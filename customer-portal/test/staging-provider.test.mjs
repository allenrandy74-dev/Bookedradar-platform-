import test from 'node:test';
import assert from 'node:assert/strict';
import {STAGING,assertStagingConfig,validateStagingConfig,guardStagingPool} from '../server/staging-config.mjs';
import {createWixMemberProvider,validateWixMemberInfo,memberFingerprint} from '../server/wix-member-provider.mjs';
const config={enabled:true,...STAGING},now=Date.parse('2026-10-12T14:00:00Z');
const info={active:true,subject_type:'MEMBER',subject_id:'synthetic-member',client_id:STAGING.wixClientId,site_id:STAGING.wixSiteId,exp:now/1000+3600,iat:now/1000};
const json=value=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
test('all staging identity/origin/database/deployment gates are exact and required',()=>{assert.deepEqual(assertStagingConfig(config),config);for(const key of Object.keys(config))assert.throws(()=>assertStagingConfig({...config,[key]:'wrong'}));assert.throws(()=>validateStagingConfig({PORTAL_STAGING_ENABLED:'true'}));});
test('existing database name is verified once before any query and mismatch cannot reach writes',async()=>{const calls=[];const source={query:async(sql)=>{calls.push(sql);return {rows:[{name:'wrong_database'}]};},connect:async()=>{throw new Error('must not connect');}};const guarded=guardStagingPool(source,config);await assert.rejects(guarded.query('INSERT forbidden'),/staging_database_mismatch/);await assert.rejects(guarded.connect(),/staging_database_mismatch/);assert.deepEqual(calls,['SELECT current_database() AS name']);});
test('Wix identity needs active unexpired exact audience MEMBER with strict known aliases',()=>{assert.equal(validateWixMemberInfo(info,config,now).subjectId,'synthetic-member');const camel={active:true,subjectType:'MEMBER',subjectId:'synthetic-member',clientId:STAGING.wixClientId,siteId:STAGING.wixSiteId,exp:info.exp};assert.equal(validateWixMemberInfo(camel,config,now).subjectId,'synthetic-member');for(const patch of [{active:false},{subject_type:'APP'},{subject_type:'USER'},{subject_type:'VISITOR'},{subject_type:'UNKNOWN'},{client_id:'wrong'},{site_id:'wrong'},{subject_id:''},{exp:now/1000},{exp:String(info.exp)},{exp:Infinity},{subjectType:'APP'},{clientId:'wrong'},{siteId:'wrong'},{subjectId:'other'},{iat:now/1000+300}])assert.throws(()=>validateWixMemberInfo({...info,...patch},config,now));assert.equal(memberFingerprint(info.subject_id,config).length,64);});
test('provider uses exact public-client PKCE/token-info REST contracts and discards tokens',async()=>{const calls=[];const responses=[json({access_token:'synthetic-visitor-access',refresh_token:'synthetic-visitor-refresh',expires_in:14400,token_type:'Bearer'}),json({redirectSession:{fullUrl:'https://www.bookedradar.com/_api/oauth2/authorize?state=synthetic'}}),json({access_token:'synthetic-member-access',refresh_token:'synthetic-member-refresh',expires_in:14400,token_type:'Bearer'}),json(info)];const provider=createWixMemberProvider({config,now:()=>now,fetchImpl:async(url,options)=>{calls.push({url,...options,body:JSON.parse(options.body)});return responses.shift();}});await provider.loginUrl({state:'state',codeChallenge:'challenge'});const result=await provider.verifyCode({code:'code',codeVerifier:'verifier'});assert.equal(calls[0].url,'https://www.wixapis.com/oauth2/token');assert.deepEqual(calls[0].body,{clientId:STAGING.wixClientId,grantType:'anonymous'});assert.equal(calls[1].body.auth.authRequest.codeChallengeMethod,'S256');assert.equal(calls[1].body.auth.authRequest.responseMode,'fragment');assert.equal(calls[1].headers.authorization,'synthetic-visitor-access');assert.deepEqual(calls[2].body,{clientId:STAGING.wixClientId,grantType:'authorization_code',redirectUri:STAGING.origin+'/api/auth/callback',code:'code',codeVerifier:'verifier'});assert.equal(calls[3].url,'https://www.wixapis.com/oauth2/token-info');assert.deepEqual(calls[3].body,{token:'synthetic-member-access'});assert.ok(calls.every(c=>c.redirect==='error'));assert.equal(JSON.stringify(result).includes('synthetic-member-access'),false);assert.equal(JSON.stringify(calls).includes('client_secret'),false);assert.equal(JSON.stringify(calls).includes('clientSecret'),false);const logout=new URL(provider.logoutUrl());assert.equal(logout.origin+logout.pathname,'https://www.wixapis.com/_api/iam/authentication/v1/logout');assert.equal(logout.searchParams.get('clientId'),STAGING.wixClientId);assert.equal(logout.searchParams.get('postLogoutRedirectUri'),STAGING.origin+'/api/auth/logout-callback');assert.equal([...logout.searchParams].length,2);});
test('provider rejects untrusted redirects, mixed audience, giant or non-JSON replies',async()=>{for(const destination of ['javascript:alert(1)','http://www.bookedradar.com/','https://attacker.test/','https://user@www.bookedradar.com/','https://www.bookedradar.com/#token','https://www.bookedradar.com/?access_token=secret']){let step=0;const provider=createWixMemberProvider({config,fetchImpl:async()=>++step===1?json({access_token:'synthetic',expires_in:14400,token_type:'Bearer'}):json({redirectSession:{fullUrl:destination}})});await assert.rejects(provider.loginUrl({state:'x',codeChallenge:'x'}));}const huge=createWixMemberProvider({config,fetchImpl:async()=>new Response('x'.repeat(65537),{headers:{'content-type':'application/json'}})});await assert.rejects(huge.loginUrl({state:'x',codeChallenge:'x'}));});

test('provider failure diagnostics have fixed labels only and never expose sensitive values',async()=>{
  const visitor=()=>json({access_token:'private-access-value',expires_in:14400,token_type:'Bearer'});
  const cases=[
    {reply:()=>{throw new Error('private exception https://secret.test/?token=private-value');},stage:'visitor_token',reason:'network_failure',status:null},
    {reply:()=>new Response('private-provider-body',{status:403}),stage:'visitor_token',reason:'http_failure',status:403},
    {reply:()=>new Response('private-html-body',{status:200,headers:{'content-type':'text/html'}}),stage:'visitor_token',reason:'content_type',status:200},
    {reply:()=>new Response('private-invalid-json',{headers:{'content-type':'application/json'}}),stage:'visitor_token',reason:'response_parse',status:200},
    {reply:()=>new Response('private'.repeat(10000),{headers:{'content-type':'application/json'}}),stage:'visitor_token',reason:'response_too_large',status:200},
    {reply:()=>json({access_token:'private',expires_in:0,token_type:'Bearer'}),stage:'visitor_token',reason:'token_shape',status:null},
    {redirect:true,reply:()=>new Response('private-provider-body',{status:400}),stage:'login_redirect',reason:'http_failure',status:400},
    {redirect:true,reply:()=>json(null),stage:'login_redirect',reason:'redirect_shape',status:null},
    {redirect:true,reply:()=>json({redirectSession:{fullUrl:'https://private.example.test/?state=private'}}),stage:'login_redirect',reason:'redirect_origin',status:null},
    {redirect:true,reply:()=>json({redirectSession:{fullUrl:'https://www.bookedradar.com/?access_token=private'}}),stage:'login_redirect',reason:'redirect_query',status:null},
  ];
  for(const item of cases){
    const diagnostics=[];let count=0;
    const provider=createWixMemberProvider({config,onDiagnostic:record=>diagnostics.push(record),fetchImpl:async()=>item.redirect&&count++===0?visitor():item.reply()});
    await assert.rejects(provider.loginUrl({state:'private-state',codeChallenge:'private-challenge'}),error=>{
      assert.equal(error.message,'wix_authentication_failed');assert.deepEqual(Object.keys(error),[]);return true;
    });
    assert.deepEqual(diagnostics,[{event:'portal_staging.wix_failure',stage:item.stage,reason:item.reason,http_status:item.status}]);
    assert.doesNotMatch(JSON.stringify(diagnostics),/private|https:|token=|state=|cookie|Bearer/);
  }
});
test('diagnostic observer failure cannot change fail-closed behavior; success produces no event',async()=>{
  const failing=createWixMemberProvider({config,fetchImpl:async()=>{throw new Error('private');},onDiagnostic:()=>{throw new Error('observer-private');}});
  await assert.rejects(failing.loginUrl({state:'x',codeChallenge:'x'}),/wix_authentication_failed/);
  let count=0,events=0;
  const success=createWixMemberProvider({config,onDiagnostic:()=>events++,fetchImpl:async()=>++count===1?json({access_token:'private-access-only',expires_in:14400,token_type:'Bearer'}):json({redirectSession:{fullUrl:'https://www.bookedradar.com/login?state=private'}})});
  await success.loginUrl({state:'private',codeChallenge:'private'});assert.equal(events,0);
});
test('member exchange diagnostics never include the member token or identity',async()=>{
  const diagnostics=[];let count=0;
  const provider=createWixMemberProvider({config,now:()=>now,onDiagnostic:record=>diagnostics.push(record),fetchImpl:async()=>++count===1?json({access_token:'private-member-token',expires_in:14400,token_type:'Bearer'}):json({...info,subject_id:'private-member',site_id:'wrong'})});
  await assert.rejects(provider.verifyCode({code:'private-code',codeVerifier:'private-verifier'}));
  assert.deepEqual(diagnostics,[{event:'portal_staging.wix_failure',stage:'token_info',reason:'identity_validation',http_status:null}]);
});


test('provider preserves opaque Wix redirect-session query data without treating names as credentials',async()=>{
  for(const query of ['sessionToken=synthetic-session','token=synthetic-session','wixSessionToken=synthetic-session','session_secret=synthetic-session','scope=openid%20offline_access','opaque=synthetic%2fsession']){
    const fullUrl='https://www.bookedradar.com/_api/oauth2/authorize?clientId=synthetic&'+query;
    let calls=0;const diagnostics=[];
    const provider=createWixMemberProvider({config,onDiagnostic:event=>diagnostics.push(event),fetchImpl:async()=>++calls===1?json({access_token:'synthetic-access-only',refresh_token:'synthetic-refresh-only',expires_in:14400,token_type:'Bearer'}):json({redirectSession:{fullUrl}})});
    assert.equal(await provider.loginUrl({state:'synthetic-state',codeChallenge:'synthetic-challenge'}),fullUrl);
    assert.deepEqual(diagnostics,[]);
  }
});
test('opaque redirects still reject credential fields, issued credentials, ambiguous keys and controls',async()=>{
  const queries=[
    'access_token=synthetic','accessToken=synthetic','ACCESS-TOKEN=synthetic','access.token=synthetic','access%20token=synthetic',
    'refresh_token=synthetic','refreshToken=synthetic','id_token=synthetic','idToken=synthetic',
    'client_secret=synthetic','clientSecret=synthetic','code_verifier=synthetic','codeVerifier=synthetic',
    'opaque=synthetic-access-only','opaque=prefix-synthetic-refresh-only-suffix',
    'synthetic-access-only=opaque','opaque=synthetic%2Daccess%2Donly',
    '=synthetic','state=one&state=two','state=one&st%61te=two','opaque=bad%0Avalue','bad%00key=value',
  ];
  for(const query of queries){
    let calls=0;const diagnostics=[];
    const provider=createWixMemberProvider({config,onDiagnostic:event=>diagnostics.push(event),fetchImpl:async()=>++calls===1?json({access_token:'synthetic-access-only',refresh_token:'synthetic-refresh-only',expires_in:14400,token_type:'Bearer'}):json({redirectSession:{fullUrl:'https://www.bookedradar.com/_api/oauth2/authorize?'+query}})});
    await assert.rejects(provider.loginUrl({state:'synthetic-state',codeChallenge:'synthetic-challenge'}),/wix_authentication_failed/);
    assert.deepEqual(diagnostics,[{event:'portal_staging.wix_failure',stage:'login_redirect',reason:'redirect_query',http_status:null}]);
    assert.doesNotMatch(JSON.stringify(diagnostics),/synthetic|https:|opaque=|state=/);
  }
});
test('opaque redirect support never widens destination or structural constraints',async()=>{
  for(const fullUrl of ['https://attacker.test/?sessionToken=synthetic','http://www.bookedradar.com/?sessionToken=synthetic','https://user@www.bookedradar.com/?sessionToken=synthetic','https://www.bookedradar.com/?sessionToken=synthetic#fragment','https://www.bookedradar.com/synthetic-access-only','https://www.bookedradar.com/%73ynthetic-access-only','https://www.bookedradar.com/\n?sessionToken=synthetic']){
    let calls=0;const provider=createWixMemberProvider({config,fetchImpl:async()=>++calls===1?json({access_token:'synthetic-access-only',expires_in:14400,token_type:'Bearer'}):json({redirectSession:{fullUrl}})});
    await assert.rejects(provider.loginUrl({state:'synthetic-state',codeChallenge:'synthetic-challenge'}),/wix_authentication_failed/);
  }
});
