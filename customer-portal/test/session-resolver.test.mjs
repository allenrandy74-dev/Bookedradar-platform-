import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createOpaqueSessionResolver, readSessionCookie, SESSION_COOKIE_NAME } from '../server/session-resolver.mjs';

// Known, synthetic 32-byte fixtures. These are not production credentials.
const token = Buffer.alloc(32, 7).toString('base64url');
const other = Buffer.alloc(32, 8).toString('base64url');
const cookie = `${SESSION_COOKIE_NAME}=${token}`;
const NOW = new Date('2026-10-12T12:00:00.000Z');
const session = { tenantId: 'tenant-a', tenantName: 'Example A', memberId: 'member-a', userId: 'user-a', active: true, revokedAt: null, expiresAt: '2026-10-12T13:00:00.000Z' };

test('opaque resolver denies unconfigured, missing and bearer-only sessions', async () => {
  assert.equal(await createOpaqueSessionResolver()({ headers: { cookie } }), null);
  let lookups = 0;
  const resolve = createOpaqueSessionResolver({ store: { getSessionByTokenHash: async () => { lookups++; return session; } }, now: () => NOW });
  assert.equal(await resolve(), null);
  assert.equal(await resolve({ headers: { authorization: `Bearer ${token}`, 'x-user-id': 'user-a' } }), null);
  assert.equal(lookups, 0);
});

test('cookie parser rejects malformed, duplicated, noncanonical, quoted or oversized tokens', () => {
  assert.equal(readSessionCookie({ cookie: `other=1; ${cookie}; unrelated=2` }), token);
  for (const value of [cookie + '; ' + cookie, `${SESSION_COOKIE_NAME}=wrong`, `${SESSION_COOKIE_NAME}="${token}"`, `${SESSION_COOKIE_NAME}=${token}=`, `${SESSION_COOKIE_NAME}=${token.slice(0, -1)}f`, `${cookie}\n`, 'a'.repeat(8200), `${SESSION_COOKIE_NAME} =${token}`]) assert.equal(readSessionCookie({ cookie: value }), null, value.slice(0, 60));
  assert.equal(readSessionCookie({ cookie: [cookie] }), null);
});

test('only SHA256 token hash reaches persistence and CSRF derivation does not expose token', async () => {
  const hashes = [];
  const resolve = createOpaqueSessionResolver({ store: { getSessionByTokenHash: async hash => { hashes.push(hash); return session; } }, now: () => NOW });
  const result = await resolve({ headers: { cookie } });
  assert.equal(hashes[0], createHash('sha256').update(token).digest('hex'));
  assert.equal(result.tenantId, 'tenant-a');
  assert.equal(result.csrfToken.length, 43);
  assert.notEqual(result.csrfToken, token);
  assert.equal((await resolve({ headers: { cookie } })).csrfToken, result.csrfToken);
  assert.notEqual((await resolve({ headers: { cookie: `${SESSION_COOKIE_NAME}=${other}` } })).csrfToken, result.csrfToken);
  assert.equal(Object.hasOwn(result, 'tokenHash'), false);
});

test('expired, revoked, disabled or malformed server session records fail closed', async () => {
  for (const value of [null, { ...session, revokedAt: NOW.toISOString() }, { ...session, active: false }, { ...session, expiresAt: NOW.toISOString() }, { ...session, expiresAt: 'invalid' }, { ...session, tenantId: '../tenant' }, { ...session, tenantName: '' }]) {
    const resolve = createOpaqueSessionResolver({ store: { getSessionByTokenHash: async () => value }, now: () => NOW });
    assert.equal(await resolve({ headers: { cookie } }), null);
  }
});

test('database failures propagate for generic availability handling instead of becoming a login', async () => {
  const resolve = createOpaqueSessionResolver({ store: { getSessionByTokenHash: async () => { throw new Error('database unavailable'); } } });
  await assert.rejects(resolve({ headers: { cookie } }), /database unavailable/);
});
