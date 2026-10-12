import { createHash } from 'node:crypto';
import { assertStagingConfig } from './staging-config.mjs';
const TOKEN_URL = 'https://www.wixapis.com/oauth2/token';
const INFO_URL = 'https://www.wixapis.com/oauth2/token-info';
const REDIRECT_URL = 'https://www.wixapis.com/_api/redirects-api/v1/redirect-session';
const LOGOUT_URL = 'https://www.wixapis.com/_api/iam/authentication/v1/logout';
const CREDENTIAL_QUERY_KEYS = new Set(['accesstoken','refreshtoken','idtoken','clientsecret','codeverifier']);
const fail = () => { throw new Error('wix_authentication_failed'); };
const DIAGNOSTIC_REASONS = new Set(['network_failure','http_failure','content_type','response_too_large','response_parse','token_shape','redirect_shape','redirect_origin','redirect_userinfo','redirect_fragment','redirect_length','redirect_query','identity_validation','unknown']);
class ProviderFailure extends Error {
  constructor(stage, reason, status = null) { super('wix_authentication_failed'); this.stage = stage; this.reason = reason; this.status = status; }
}
const bounded = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x20\x7f]/.test(value);
function alias(object, snake, camel) {
  if (Object.hasOwn(object, snake) && Object.hasOwn(object, camel) && object[snake] !== object[camel]) fail();
  return Object.hasOwn(object, snake) ? object[snake] : object[camel];
}
export function validateWixMemberInfo(info, config, now = Date.now()) {
  assertStagingConfig(config);
  if (!info || typeof info !== 'object' || info.active !== true) fail();
  const subjectType = alias(info, 'subject_type', 'subjectType');
  const subjectId = alias(info, 'subject_id', 'subjectId');
  const clientId = alias(info, 'client_id', 'clientId');
  const siteId = alias(info, 'site_id', 'siteId');
  if (subjectType !== 'MEMBER' || clientId !== config.wixClientId || siteId !== config.wixSiteId
    || !bounded(subjectId, 128) || !/^[A-Za-z0-9_-]+$/.test(subjectId)
    || typeof info.exp !== 'number' || !Number.isSafeInteger(info.exp) || info.exp * 1000 <= now
    || (info.iat !== undefined && (typeof info.iat !== 'number' || !Number.isSafeInteger(info.iat) || info.iat * 1000 > now + 30000))) fail();
  return { subjectId, expiresAt: new Date(info.exp * 1000).toISOString() };
}
export function memberFingerprint(subjectId, config) {
  assertStagingConfig(config);
  if (!bounded(subjectId, 128) || !/^[A-Za-z0-9_-]+$/.test(subjectId)) fail();
  return createHash('sha256').update(JSON.stringify(['bookedradar-staging-member-v1', config.wixSiteId, config.wixClientId, 'MEMBER', subjectId])).digest('hex');
}
export function createWixMemberProvider({ config, fetchImpl = globalThis.fetch, now = () => Date.now(), onDiagnostic = () => {} } = {}) {
  assertStagingConfig(config);
  const reject = (stage, reason, status = null) => { throw new ProviderFailure(stage, reason, status); };
  const report = error => {
    const stage = error instanceof ProviderFailure && ['visitor_token','login_redirect','member_token','token_info'].includes(error.stage) ? error.stage : 'unknown';
    const reason = error instanceof ProviderFailure && DIAGNOSTIC_REASONS.has(error.reason) ? error.reason : 'unknown';
    const status = error instanceof ProviderFailure && Number.isInteger(error.status) && error.status >= 100 && error.status <= 599 ? error.status : null;
    // Fixed labels only: never emit raw exceptions, URLs, bodies, cookies or identity.
    try { onDiagnostic({event:'portal_staging.wix_failure',stage,reason,http_status:status}); } catch {}
  };
  async function observed(operation) { try { return await operation(); } catch (error) { report(error); fail(); } }
  async function post(stage, url, body, accessToken) {
    let response;
    try { response = await fetchImpl(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { 'content-type': 'application/json', ...(accessToken ? { authorization: accessToken } : {}) }, body: JSON.stringify(body) }); }
    catch { reject(stage,'network_failure'); }
    if (!response.ok) reject(stage,'http_failure',response.status);
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) reject(stage,'content_type',response.status);
    let reader; try { reader = response.body.getReader(); } catch { reject(stage,'response_parse',response.status); }
    const chunks = []; let size = 0;
    try {
      for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 65536) { await reader.cancel(); reject(stage,'response_too_large',response.status); } chunks.push(value); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (error) { if(error instanceof ProviderFailure)throw error; reject(stage,'response_parse',response.status); } finally { reader.releaseLock(); }
  }
  const token = (stage,response) => { if (!bounded(response?.access_token, 16000) || response.token_type !== 'Bearer' || !Number.isSafeInteger(response.expires_in) || response.expires_in <= 0 || response.expires_in > 14400) reject(stage,'token_shape'); return response.access_token; };
  return Object.freeze({
    async loginUrl({ state, codeChallenge }) {
      return observed(async () => {
      const visitorResponse = await post('visitor_token',TOKEN_URL, { clientId: config.wixClientId, grantType: 'anonymous' });
      const visitor = token('visitor_token',visitorResponse);
      const result = await post('login_redirect',REDIRECT_URL, { auth: { authRequest: { redirectUri: `${config.origin}/api/auth/callback`, clientId: config.wixClientId, codeChallenge, codeChallengeMethod: 'S256', responseMode: 'fragment', responseType: 'code', scope: 'offline_access', state } } }, visitor);
      const fullUrl = result?.redirectSession?.fullUrl;
      if (typeof fullUrl !== 'string' || /[\x00-\x20\x7f\\]/.test(fullUrl)) reject('login_redirect','redirect_shape');
      let url, decodedFullUrl; try { url = new URL(fullUrl); decodedFullUrl = decodeURIComponent(fullUrl); } catch { reject('login_redirect','redirect_shape'); }
      // Fixed, verified published Wix site; unfamiliar destinations fail closed.
      if (url.origin !== 'https://www.bookedradar.com') reject('login_redirect','redirect_origin');
      if (url.username || url.password) reject('login_redirect','redirect_userinfo');
      if (url.hash) reject('login_redirect','redirect_fragment');
      if (fullUrl.length > 8192 || url.href.length > 8192) reject('login_redirect','redirect_length');
      // Wix documents fullUrl as an opaque provider-issued navigation URL. Its SDK
      // returns it unchanged; query names containing "token" are not inherently
      // access/refresh credentials. Keep destination checks above and prevent
      // actual issued credentials or standard credential fields from escaping.
      const credentials = [visitor, visitorResponse.refresh_token].filter(value => typeof value === 'string' && value.length > 0);
      const keys = new Set();
      for (const [key,value] of url.searchParams) {
        if (!key || keys.has(key) || /[\x00-\x1f\x7f]/.test(key + value)
          || CREDENTIAL_QUERY_KEYS.has(key.replace(/[^a-z0-9]/gi,'').toLowerCase())) reject('login_redirect','redirect_query');
        keys.add(key);
      }
      if (/[\x00-\x1f\x7f]/.test(decodedFullUrl)
        || credentials.some(credential => fullUrl.includes(credential) || decodedFullUrl.includes(credential))) reject('login_redirect','redirect_query');
      return fullUrl;
      });
    },
    async verifyCode({ code, codeVerifier }) {
      return observed(async () => {
      const result = await post('member_token',TOKEN_URL, { clientId: config.wixClientId, grantType: 'authorization_code', redirectUri: `${config.origin}/api/auth/callback`, code, codeVerifier });
      const access = token('member_token',result);
      const response = await post('token_info',INFO_URL, { token: access });
      let info; try { info = validateWixMemberInfo(response, config, now()); } catch { reject('token_info','identity_validation'); }
      // Provider access/refresh tokens are never retained, returned or sent to the browser.
      return { fingerprint: memberFingerprint(info.subjectId, config), expiresAt: new Date(Math.min(Date.parse(info.expiresAt), now() + result.expires_in * 1000)).toISOString() };
      });
    },
    logoutUrl() {
      const url = new URL(LOGOUT_URL);
      url.searchParams.set('clientId', config.wixClientId);
      url.searchParams.set('postLogoutRedirectUri', `${config.origin}/api/auth/logout-callback`);
      return url.href;
    },
  });
}
