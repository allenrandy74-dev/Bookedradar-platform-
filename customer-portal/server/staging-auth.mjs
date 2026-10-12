import { createHash, randomBytes as secureRandomBytes, timingSafeEqual } from 'node:crypto';
import { assertStagingConfig } from './staging-config.mjs';
import { createWixMemberProvider } from './wix-member-provider.mjs';
import { createStagingAuthStore } from './staging-auth-store.mjs';
import { createPostgresPortalStore } from './postgres-store.mjs';
import { createOpaqueSessionResolver, readSessionCookie, SESSION_COOKIE_NAME } from './session-resolver.mjs';
export const LOGIN_COOKIE_NAME = '__Host-bookedradar_login';
const hash = value => createHash('sha256').update(value).digest('hex');
const opaque = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value) && Buffer.from(value,'base64url').toString('base64url') === value;
const equal = (a,b) => typeof a === 'string' && typeof b === 'string' && a.length <= 512 && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));
const cookie = (name,value,seconds) => `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${seconds}`;
const clear = name => cookie(name,'',0);
class AuthError extends Error { constructor(status,code) { super(code); this.status=status; this.code=code; } }
const requireValue = (ok,status,code) => { if (!ok) throw new AuthError(status,code); };
function loginCookie(headers) {
  if (typeof headers.cookie !== 'string' || headers.cookie.length > 8192 || /[\r\n\x00]/.test(headers.cookie)) return null;
  const items = headers.cookie.split(';').map(s=>s.trim()).filter(s=>s.split('=')[0]===LOGIN_COOKIE_NAME);
  if (items.length!==1) return null;
  const value=items[0].slice(LOGIN_COOKIE_NAME.length+1); return opaque(value)?value:null;
}
const CALLBACK_SCRIPT = `(() => {
  const out = document.getElementById('result');
  const failure = 'We couldn’t confirm portal sign-in. Return to the portal to check your access. If it’s still unavailable, contact the owner.';
  const fragment = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', '/api/auth/callback');
  const keys = [...fragment.keys()];
  const state = fragment.get('state');
  if (!state || fragment.getAll('state').length !== 1 || keys.some(key => !['state','code','error','error_description'].includes(key)) || fragment.getAll('code').length > 1) { out.textContent = failure; return; }
  const body = fragment.has('error') ? {state,error:'provider_denied'} : {state,code:fragment.get('code')};
  fetch('/api/auth/callback', {method:'POST',credentials:'same-origin',redirect:'error',headers:{'Content-Type':'application/json','X-Login-CSRF':state},body:JSON.stringify(body)})
    .then(async response => ({response,data:await response.json()}))
    .then(({response,data}) => {
      const bindingRequired = data.error === 'membership_binding_required' && /^[a-f0-9]{64}$/.test(data.fingerprint || '');
      // Replayed or superseded callbacks must not interrupt a newer signed-in tab.
      if (response.ok || bindingRequired) {
        try { const channel = new BroadcastChannel('bookedradar-portal-auth'); channel.postMessage({type:'auth-changed'}); channel.close(); } catch {}
      }
      if (response.ok) { location.replace('/portal'); return; }
      if (bindingRequired) {
        out.textContent = 'Wix sign-in verified. Portal access needs owner confirmation. Ask the owner to review this test-account fingerprint:';
        const fingerprint = document.getElementById('fingerprint');
        const copy = document.getElementById('copy-fingerprint');
        const copyStatus = document.getElementById('copy-status');
        fingerprint.value = data.fingerprint;
        document.getElementById('identity-confirmation').hidden = false;
        copy.addEventListener('click', async () => {
          if (copy.disabled) return;
          copy.disabled = true;
          copyStatus.textContent = 'Copying fingerprint…';
          try {
            if (typeof navigator.clipboard?.writeText !== 'function') throw new Error('clipboard_unavailable');
            await navigator.clipboard.writeText(fingerprint.value);
            copyStatus.textContent = 'Fingerprint copied.';
          } catch {
            fingerprint.focus();
            fingerprint.select();
            copyStatus.textContent = 'Couldn’t copy automatically. Select the fingerprint and use your device’s copy command.';
          } finally { copy.disabled = false; }
        });
      } else { out.textContent = failure; }
    }).catch(() => { out.textContent = failure; });
})();`;
const CALLBACK_STYLE = `*{box-sizing:border-box}body{margin:0;padding:1rem;background:#f5f7f9;color:#172535;font-family:system-ui,sans-serif;line-height:1.6}main{max-width:44rem;margin:clamp(1rem,6vw,4rem) auto;padding:clamp(1rem,4vw,2rem);background:#fff;border:1px solid #cbd5df;border-radius:1rem}h1{margin:0 0 1rem;font-size:clamp(1.5rem,5vw,2rem);line-height:1.25}p{margin:1rem 0;overflow-wrap:anywhere}label{display:block;margin-bottom:.5rem;font-weight:650}textarea{display:block;width:100%;min-width:0;max-width:100%;min-height:5.5em;padding:.75rem;border:1px solid #65788a;border-radius:.5rem;background:#f5f7f9;color:#172535;font:1rem/1.5 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-all;resize:vertical}button{max-width:100%;min-height:44px;padding:.65rem 1rem;border:1px solid #135e5a;border-radius:.5rem;background:#135e5a;color:#fff;font:inherit;font-weight:650;cursor:pointer}button:disabled{cursor:wait}a{color:#135e5a;text-underline-offset:.2em}a:focus-visible,button:focus-visible,textarea:focus-visible{outline:3px solid #135e5a;outline-offset:3px}#copy-status{min-height:1.6em}#fingerprint-help{font-size:.9375rem}`;
export function callbackPage() {
  return { body:`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BookedRadar sign-in</title><style>${CALLBACK_STYLE}</style></head><body><main><h1>BookedRadar sign-in</h1><p id="result" role="status" aria-live="polite" aria-atomic="true">Verifying your sign-in…</p><div id="identity-confirmation" hidden><label for="fingerprint">Test-account fingerprint</label><textarea id="fingerprint" rows="3" readonly spellcheck="false" autocomplete="off" autocapitalize="off" wrap="soft" aria-describedby="fingerprint-help copy-status"></textarea><p id="fingerprint-help">Share this fingerprint with the owner to review portal access.</p><button id="copy-fingerprint" type="button">Copy fingerprint</button><p id="copy-status" role="status" aria-live="polite" aria-atomic="true"></p></div><p><a href="/portal">Back to the portal</a></p></main><script>${CALLBACK_SCRIPT}</script></body></html>`, csp:`default-src 'none'; script-src 'sha256-${createHash('sha256').update(CALLBACK_SCRIPT).digest('base64')}'; style-src 'sha256-${createHash('sha256').update(CALLBACK_STYLE).digest('base64')}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'` };
}
export function createStagingAuthService({config,store,provider,resolveSession,now=()=>Date.now(),randomBytes=secureRandomBytes}={}) {
  let configured=false; try { assertStagingConfig(config); configured=!!store&&!!provider&&typeof resolveSession==='function'; } catch {}
  return async function auth(input={}) {
    const headers = Object.fromEntries(Object.entries(input.headers||{}).map(([key,value])=>[key.toLowerCase(),value]));
    const responseHeaders={'content-type':'application/json; charset=utf-8','cache-control':'no-store, private',pragma:'no-cache','x-content-type-options':'nosniff','referrer-policy':'no-referrer','cross-origin-opener-policy':'same-origin','content-security-policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'"};
    const respond=(status,body)=>({status,headers:responseHeaders,body});
    try {
      requireValue(configured,503,'staging_auth_not_configured');
      const url=new URL(input.url||'/',config.origin); const method=(input.method||'GET').toUpperCase();
      requireValue(url.origin===config.origin&&!url.search&&!url.hash,400,'invalid_auth_request');
      if(method==='GET'&&url.pathname==='/api/auth/callback') {
        const page=callbackPage(); responseHeaders['content-type']='text/html; charset=utf-8'; responseHeaders['content-security-policy']=page.csp; return respond(200,page.body);
      }
      if(method==='GET'&&url.pathname==='/api/auth/logout-callback') {
        const script="try { const channel=new BroadcastChannel('bookedradar-portal-auth'); channel.postMessage({type:'auth-changed'}); channel.close(); } catch {} location.replace('/portal?auth=signed_out');";
        responseHeaders['content-type']='text/html; charset=utf-8';
        responseHeaders['content-security-policy']=`default-src 'none'; script-src 'sha256-${createHash('sha256').update(script).digest('base64')}'; base-uri 'none'; frame-ancestors 'none'`;
        return respond(200,`<!doctype html><html lang="en"><meta charset="utf-8"><title>Signed out</title><p>Signed out. <a href="/portal?auth=signed_out">Return to the portal</a></p><script>${script}</script></html>`);
      }
      if(method==='GET'&&url.pathname==='/api/auth/login') {
        requireValue(['same-origin','none'].includes(headers['sec-fetch-site'])&&(headers.origin===undefined||headers.origin===config.origin),403,'origin_forbidden');
        const state=randomBytes(32).toString('base64url'); const browser=loginCookie(headers)||randomBytes(32).toString('base64url'); const codeVerifier=randomBytes(32).toString('base64url');
        const previousBrowser=loginCookie(headers), previousSession=readSessionCookie(headers);
        await store.beginFlow({stateHash:hash(state),browserHash:hash(browser),codeVerifier,previousBrowserHash:previousBrowser?hash(previousBrowser):null,previousSessionHash:previousSession?hash(previousSession):null});
        responseHeaders['set-cookie']=[clear(SESSION_COOKIE_NAME),cookie(LOGIN_COOKIE_NAME,browser,300)];
        try { responseHeaders.location=await provider.loginUrl({state,codeChallenge:createHash('sha256').update(codeVerifier).digest('base64url')}); }
        catch { await store.abandonFlow({stateHash:hash(state),browserHash:hash(browser)}); throw new AuthError(503,'provider_unavailable'); }
        return respond(303,{ok:true});
      }
      requireValue(method==='POST'&&['/api/auth/callback','/api/auth/logout','/api/auth/rotate'].includes(url.pathname),404,'not_found');
      requireValue(headers.origin===config.origin&&headers['sec-fetch-site']!=='cross-site',403,'origin_forbidden');
      requireValue(headers['content-type']?.split(';')[0].trim().toLowerCase()==='application/json',415,'json_required');
      const body=input.body; requireValue(body&&typeof body==='object'&&!Array.isArray(body),400,'invalid_auth_request');
      if(url.pathname==='/api/auth/callback') {
        requireValue(Object.keys(body).every(key=>['code','state','error'].includes(key))&&opaque(body.state)&&equal(headers['x-login-csrf'],body.state),400,'invalid_auth_request');
        const browser=loginCookie(headers); requireValue(browser,400,'invalid_login_flow');
        requireValue(body.error==='provider_denied'||(typeof body.code==='string'&&body.code.length>0&&body.code.length<=4096&&!/[\x00-\x20\x7f]/.test(body.code)&&body.error===undefined),400,'invalid_auth_request');
        const flow=await store.consumeFlow({stateHash:hash(body.state),browserHash:hash(browser)}); requireValue(flow,400,'invalid_login_flow');
        // Do not clear the local session on callback replay: another callback may
        // already have successfully installed a fresh cookie. Login start revoked A.
        requireValue(!body.error,401,'sign_in_cancelled');
        const identity=await provider.verifyCode({code:body.code,codeVerifier:flow.codeVerifier});
        requireValue(/^[a-f0-9]{64}$/.test(identity?.fingerprint||'')&&Number.isFinite(Date.parse(identity?.expiresAt))&&Date.parse(identity.expiresAt)>now(),401,'invalid_provider_identity');
        const expiresAt=new Date(Math.min(Date.parse(identity.expiresAt),now()+30*60*1000)).toISOString();
        const raw=randomBytes(32).toString('base64url');
        const binding=await store.issueSession({fingerprint:identity.fingerprint,tokenHash:hash(raw),expiresAt,stateHash:hash(body.state),browserHash:hash(browser)});
        requireValue(binding?.kind!=='invalid_flow',400,'invalid_login_flow');
        if(binding?.kind==='binding_required') return respond(403,{ok:false,error:'membership_binding_required',fingerprint:identity.fingerprint});
        requireValue(binding?.kind==='issued',503,'authentication_unavailable');
        responseHeaders['set-cookie']=[cookie(LOGIN_COOKIE_NAME,browser,1800)];
        responseHeaders['set-cookie'].push(cookie(SESSION_COOKIE_NAME,raw,Math.max(1,Math.floor((Date.parse(expiresAt)-now())/1000))));
        return respond(200,{ok:true,redirectUrl:'/portal'});
      }
      requireValue(Object.keys(body).length===0,400,'invalid_auth_request');
      const raw=readSessionCookie(headers); const session=await resolveSession({method,url:input.url,headers});
      if(!raw||!session) {
        requireValue(url.pathname==='/api/auth/logout',401,'authentication_required');
        const browser=loginCookie(headers); if(browser)await store.invalidateBrowser(hash(browser));
        responseHeaders['set-cookie']=[clear(SESSION_COOKIE_NAME),clear(LOGIN_COOKIE_NAME)];
        return respond(200,{ok:true,redirectUrl:'/api/auth/logout-callback'});
      }
      requireValue(equal(headers['x-csrf-token'],session.csrfToken),403,'csrf_failed');
      if(url.pathname==='/api/auth/logout') {
        const browser=loginCookie(headers); if(browser)await store.invalidateBrowser(hash(browser));
        await store.revokeSession(hash(raw));
        responseHeaders['set-cookie']=[clear(SESSION_COOKIE_NAME),clear(LOGIN_COOKIE_NAME)];
        // The fixed provider endpoint clears Wix browser cookies; local revocation
        // has already committed and does not depend on the provider succeeding.
        let redirectUrl='/api/auth/logout-callback'; try { redirectUrl=provider.logoutUrl(); } catch {}
        return respond(200,{ok:true,redirectUrl});
      }
      const rotated=randomBytes(32).toString('base64url');
      const result=await store.rotateSession({previousHash:hash(raw),nextHash:hash(rotated)});
      requireValue(result,401,'authentication_required');
      responseHeaders['set-cookie']=[cookie(SESSION_COOKIE_NAME,rotated,Math.max(1,Math.floor((Date.parse(result.expiresAt)-now())/1000)))];
      return respond(200,{ok:true});
    } catch(error) { if(error?.message==='staging_auth_rate_limited')return respond(429,{ok:false,error:'sign_in_rate_limited'}); return respond(error instanceof AuthError?error.status:503,{ok:false,error:error instanceof AuthError?error.code:'authentication_unavailable'}); }
  };
}
/** No listener/DDL. Parent mounts this before any general JSON body parser. */
export function createStagingAuthHandler({pool,config,fetchImpl=globalThis.fetch}={}) {
  assertStagingConfig(config);
  const store=createStagingAuthStore({pool,config});
  const portalStore=createPostgresPortalStore({pool,schema:config.schema,stagingConfig:config});
  const resolveSession=createOpaqueSessionResolver({store:portalStore});
  const service=createStagingAuthService({config,store,provider:createWixMemberProvider({config,fetchImpl,onDiagnostic:record=>console.warn(JSON.stringify(record))}),resolveSession});
  const handler=async(req,res)=>{
    const path=String(req.url||'').split('?')[0]; if(!path.startsWith('/api/auth/')) return false;
    let size=0; const chunks=[];
    const send=result=>{res.writeHead(result.status,result.headers);res.end(typeof result.body==='string'?result.body:JSON.stringify(result.body));};
    try {
      for await(const chunk of req) {size+=chunk.length;if(size>8192){send({status:413,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:false,error:'body_too_large'}});return true;}chunks.push(chunk);}
      let body; if(size) {try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{send({status:400,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:false,error:'invalid_json'}});return true;}}
      send(await service({method:req.method,url:req.url,headers:req.headers,body}));
    }catch{if(!res.headersSent)send({status:400,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:false,error:'invalid_auth_request'}});}
    return true;
  };
  return Object.freeze({handler,store,portalStore,resolveSession});
}
