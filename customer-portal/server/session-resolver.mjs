import { createHash, createHmac } from 'node:crypto';

export const SESSION_COOKIE_NAME = '__Host-bookedradar_portal';
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** Strictly parse one canonical opaque token; no bearer/URL/header identity fallback. */
export function readSessionCookie(headers = {}) {
  const cookie = headers.cookie;
  if (typeof cookie !== 'string' || cookie.length > 8192 || /[\r\n\u0000]/.test(cookie)) return null;
  const matches = cookie.split(';').map(part => part.trim()).filter(part => part.split('=')[0] === SESSION_COOKIE_NAME);
  if (matches.length !== 1) return null;
  const token = matches[0].slice(SESSION_COOKIE_NAME.length + 1);
  if (!TOKEN.test(token) || Buffer.from(token, 'base64url').length !== 32 || Buffer.from(token, 'base64url').toString('base64url') !== token) return null;
  return token;
}

/**
 * Inactive until supplied a real store. This only verifies existing sessions.
 * No login callback, issuer, token creation, Set-Cookie, or membership grant exists.
 * The approved identity flow must set this __Host- cookie Secure; HttpOnly; Path=/;
 * SameSite=Lax or stricter with no Domain attribute. HttpOnly is not observable
 * in an incoming Cookie header and must be enforced by that future issuer.
 */
export function createOpaqueSessionResolver({ store, now = () => new Date() } = {}) {
  return async function resolveSession({ headers = {} } = {}) {
    if (!store || typeof store.getSessionByTokenHash !== 'function') return null;
    const token = readSessionCookie(headers);
    if (!token) return null;
    const hash = createHash('sha256').update(token, 'utf8').digest('hex');
    const session = await store.getSessionByTokenHash(hash);
    if (!session || session.revokedAt !== null || session.active !== true
      || !ID.test(session.tenantId || '') || !ID.test(session.memberId || '') || !ID.test(session.userId || '')
      || typeof session.tenantName !== 'string' || session.tenantName.length === 0 || session.tenantName.length > 200
      || !Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= now().getTime()) return null;
    return {
      // Internal authorization context only; API session DTO never serializes it.
      sessionHash: hash,
      tenantId: session.tenantId, tenantName: session.tenantName,
      memberId: session.memberId, userId: session.userId, expiresAt: session.expiresAt,
      // One-way derivation binds CSRF to this session without exposing the HttpOnly token.
      csrfToken: createHmac('sha256', token).update('bookedradar-portal-csrf-v1', 'utf8').digest('base64url'),
    };
  };
}
