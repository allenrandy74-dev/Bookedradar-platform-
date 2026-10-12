import { createHash } from 'node:crypto';
import { assertStagingConfig } from './staging-config.mjs';
const TOKEN_URL = 'https://www.wixapis.com/oauth2/token';
const INFO_URL = 'https://www.wixapis.com/oauth2/token-info';
const REDIRECT_URL = 'https://www.wixapis.com/_api/redirects-api/v1/redirect-session';
const LOGOUT_URL = 'https://www.wixapis.com/_api/iam/authentication/v1/logout';
const fail = () => { throw new Error('wix_authentication_failed'); };
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
export function createWixMemberProvider({ config, fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  assertStagingConfig(config);
  async function post(url, body, accessToken) {
    const response = await fetchImpl(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { 'content-type': 'application/json', ...(accessToken ? { authorization: accessToken } : {}) }, body: JSON.stringify(body) });
    if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('application/json')) fail();
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    try {
      for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 65536) { await reader.cancel(); fail(); } chunks.push(value); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { fail(); } finally { reader.releaseLock(); }
  }
  const token = response => { if (!bounded(response?.access_token, 16000) || response.token_type !== 'Bearer' || !Number.isSafeInteger(response.expires_in) || response.expires_in <= 0 || response.expires_in > 14400) fail(); return response.access_token; };
  return Object.freeze({
    async loginUrl({ state, codeChallenge }) {
      const visitor = token(await post(TOKEN_URL, { clientId: config.wixClientId, grantType: 'anonymous' }));
      const result = await post(REDIRECT_URL, { auth: { authRequest: { redirectUri: `${config.origin}/api/auth/callback`, clientId: config.wixClientId, codeChallenge, codeChallengeMethod: 'S256', responseMode: 'fragment', responseType: 'code', scope: 'offline_access', state } } }, visitor);
      let url; try { url = new URL(result.redirectSession?.fullUrl); } catch { fail(); }
      // Fixed, verified published Wix site; unfamiliar destinations fail closed.
      if (url.origin !== 'https://www.bookedradar.com' || url.username || url.password || url.hash || url.href.length > 8192 || [...url.searchParams.keys()].some(key => /token|secret/i.test(key))) fail();
      return url.href;
    },
    async verifyCode({ code, codeVerifier }) {
      const result = await post(TOKEN_URL, { clientId: config.wixClientId, grantType: 'authorization_code', redirectUri: `${config.origin}/api/auth/callback`, code, codeVerifier });
      const access = token(result);
      const info = validateWixMemberInfo(await post(INFO_URL, { token: access }), config, now());
      // Provider access/refresh tokens are never retained, returned or sent to the browser.
      return { fingerprint: memberFingerprint(info.subjectId, config), expiresAt: new Date(Math.min(Date.parse(info.expiresAt), now() + result.expires_in * 1000)).toISOString() };
    },
    logoutUrl() {
      const url = new URL(LOGOUT_URL);
      url.searchParams.set('clientId', config.wixClientId);
      url.searchParams.set('postLogoutRedirectUri', `${config.origin}/api/auth/logout-callback`);
      return url.href;
    },
  });
}
