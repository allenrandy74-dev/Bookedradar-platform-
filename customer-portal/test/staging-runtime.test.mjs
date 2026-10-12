import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createStagingRuntime, stagingRuntimeConfig, createStagingMiddleware, isStagingPath, STAGING_ORIGIN, STAGING_SERVICE, STAGING_DATABASE, STAGING_DATABASE_HOST } from '../server/staging-runtime.mjs';

const env = () => ({ PORTAL_STAGING_ENABLED: 'true', PRIVATE_VOICE_LAB: 'true', RENDER_SERVICE_NAME: STAGING_SERVICE,
  PORTAL_STAGING_ORIGIN: STAGING_ORIGIN, PRIVATE_VOICE_LAB_DATABASE_HOST: STAGING_DATABASE_HOST,
  DATABASE_URL: `postgresql://synthetic_fixture:fixture_only@${STAGING_DATABASE_HOST}/${STAGING_DATABASE}`,
  VOICE_ENABLED: 'false', DISPATCH_ENABLED: 'false', BOOKEDRADAR_BILLING_ENABLED: 'false', OPS_ALERTS_ENABLED: 'false', WARM_TRANSFER_ENABLED: 'false', DEMO_NUMBER_PROVISION_MODE: 'off' });

test('staging runtime is inert by default without database or provider imports', async () => {
  assert.equal(stagingRuntimeConfig({}), null);
  assert.equal(stagingRuntimeConfig({ PORTAL_STAGING_ENABLED: 'false', DATABASE_URL: 'invalid' }), null);
  let pools = 0;
  assert.equal(await createStagingRuntime({ env: {}, poolFactory: () => pools++ }), null);
  assert.equal(pools, 0);
});
test('staging gate accepts only exact lab identity, origin, database and disabled provider settings', () => {
  assert.equal(stagingRuntimeConfig(env()).schema, 'bookedradar_portal_staging');
  for (const patch of [
    { PORTAL_STAGING_ENABLED: 'TRUE' }, { PRIVATE_VOICE_LAB: 'false' }, { RENDER_SERVICE_NAME: 'bookedradar-platform' },
    { PORTAL_STAGING_ORIGIN: 'https://bookedradar.com' }, { PRIVATE_VOICE_LAB_MAINTENANCE: 'true' },
    { PRIVATE_VOICE_LAB_DATABASE_HOST: 'dpg-production' }, { DATABASE_URL: 'postgresql://fixture@dpg-production/production' },
    { DATABASE_URL: env().DATABASE_URL + '?host=production' }, { DATABASE_URL: env().DATABASE_URL + '#fragment' },
    { DATABASE_URL: env().DATABASE_URL.replace(STAGING_DATABASE_HOST, STAGING_DATABASE_HOST + ':5433') },
    { DEMO_NUMBER_PROVISION_MODE: 'on' }, { MIGRATION_ON_STARTUP: 'true' },
    ...['VOICE_ENABLED', 'DISPATCH_ENABLED', 'BOOKEDRADAR_BILLING_ENABLED', 'OPS_ALERTS_ENABLED', 'WARM_TRANSFER_ENABLED'].map(key => ({ [key]: 'true' })),
  ]) assert.throws(() => stagingRuntimeConfig({ ...env(), ...patch }));
});

const response = () => ({ headersSent: false, writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true; }, end(body) { this.body = body; } });
test('routing is additive and does not capture health, voice, dashboards or operational APIs', async () => {
  let next = 0, handlers = 0;
  const middleware = createStagingMiddleware({ config: stagingRuntimeConfig(env()), authHandler: () => handlers++, portalHandler: () => handlers++ });
  for (const url of ['/health', '/openai/webhook', '/api/v1/events', '/dashboard', '/assets/style.css', '/portals', '/api/authentication']) {
    assert.equal(isStagingPath(url), false);
    await middleware({ url, headers: {} }, response(), () => next++);
  }
  assert.equal(next, 7); assert.equal(handlers, 0);
});
test('static serving has an exact file allowlist, no fixtures/backend files and no stale caching', async () => {
  const config = stagingRuntimeConfig(env()); let reads = [];
  const middleware = createStagingMiddleware({ config, authHandler: () => false, portalHandler: () => {}, readAsset: async name => { reads.push(name); return '<synthetic>'; } });
  const request = async (url, method = 'GET', headers = {}) => {
    const res = response(); await middleware({ url, method, headers: { host: new URL(STAGING_ORIGIN).host, 'x-forwarded-proto': 'https', ...headers } }, res, () => assert.fail('unexpected fallthrough')); return res;
  };
  const page = await request('/portal'); assert.equal(page.status, 200); assert.equal(page.headers['cache-control'], 'no-store, private');
  assert.match(page.headers['content-security-policy'], /connect-src 'self'/);
  assert.equal((await request('/portal/assets/client.mjs')).status, 200);
  assert.equal((await request('/portal/assets/staging-app.mjs', 'HEAD')).body, undefined);
  for (const path of ['/portal/assets/fixtures.mjs', '/portal/assets/server/api.mjs', '/portal/assets/../server/api.mjs', '/portal/assets/%2e%2e%2fserver%2fapi.mjs', '/portal/.env']) assert.equal((await request(path)).status, 404);
  assert.equal((await request('/portal', 'POST')).status, 405);
  assert.equal((await request('/portal', 'GET', { host: 'evil.example' })).status, 400);
  assert.equal((await request('/portal', 'GET', { 'x-forwarded-proto': 'http' })).status, 400);
  assert.deepEqual(reads, ['staging-index.html', 'client.mjs', 'staging-app.mjs']);
});
test('auth and customer API handlers receive the untouched request before body parsing', async () => {
  const config = stagingRuntimeConfig(env()), seen = [];
  const middleware = createStagingMiddleware({ config, authHandler: async (req, res) => { seen.push(req); res.end('auth'); return true; }, portalHandler: async (req, res) => { seen.push(req); res.end('api'); } });
  for (const url of ['/api/auth/callback', '/api/customer-portal/v1/inquiries']) {
    const req = { url, method: 'POST', headers: { host: new URL(STAGING_ORIGIN).host, 'x-forwarded-proto': 'https' } };
    await middleware(req, response(), () => assert.fail()); assert.equal(seen.at(-1), req);
  }
  const source = await readFile(new URL('../../server.js', import.meta.url), 'utf8');
  assert.ok(source.indexOf('app.use(portalStaging.middleware)') < source.indexOf('app.use(express.json'));
  assert.match(source, /PORTAL_STAGING_ENABLED !== undefined/);
});
