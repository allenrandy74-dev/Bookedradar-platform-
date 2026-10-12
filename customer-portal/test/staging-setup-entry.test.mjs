import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { STAGING_SETUP_ID, setupModeRequested, runStagingSetupMode, createSetupMaintenanceHandler } from '../server/staging-setup-entry.mjs';
import { STAGING_ORIGIN, STAGING_SERVICE, STAGING_DATABASE, STAGING_DATABASE_HOST } from '../server/staging-runtime.mjs';
const env = () => ({ PORTAL_STAGING_SETUP: STAGING_SETUP_ID, PORTAL_STAGING_ENABLED: 'true', PRIVATE_VOICE_LAB: 'true', RENDER_SERVICE_NAME: STAGING_SERVICE,
  PORTAL_STAGING_ORIGIN: STAGING_ORIGIN, PRIVATE_VOICE_LAB_DATABASE_HOST: STAGING_DATABASE_HOST,
  DATABASE_URL: `postgresql://synthetic_fixture:fixture_only@${STAGING_DATABASE_HOST}/${STAGING_DATABASE}`,
  VOICE_ENABLED: 'false', DISPATCH_ENABLED: 'false', BOOKEDRADAR_BILLING_ENABLED: 'false', OPS_ALERTS_ENABLED: 'false', WARM_TRANSFER_ENABLED: 'false', DEMO_NUMBER_PROVISION_MODE: 'off' });
const response = () => ({ writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } });
test('setup requires exact migration opt-in before opening a database', async () => {
  assert.equal(setupModeRequested({}), false);
  assert.equal(setupModeRequested({ PORTAL_STAGING_SETUP: 'false' }), false);
  assert.equal(setupModeRequested(env()), true);
  let pools = 0;
  for (const patch of [{ PORTAL_STAGING_SETUP: undefined }, { PORTAL_STAGING_SETUP: 'true' }, { PORTAL_STAGING_ENABLED: 'false' }, { VOICE_ENABLED: 'true' }, { PORT: '65536' }]) {
    await assert.rejects(runStagingSetupMode({ env: { ...env(), ...patch }, poolFactory: () => pools++, listen: false }));
  }
  assert.equal(pools, 0);
});
test('setup completes and closes existing connection before maintenance can serve', async () => {
  const events = [];
  const result = await runStagingSetupMode({ env: env(), listen: false,
    poolFactory: async options => { assert.equal(options.max, 1); events.push('pool'); return { end: async () => events.push('close') }; },
    setupSchema: async ({ config }) => { assert.equal(config.databaseName, STAGING_DATABASE); events.push('setup'); } });
  assert.deepEqual(events, ['pool', 'setup', 'close']);
  const res = response(); result.handler({ method: 'GET', url: '/health' }, res);
  assert.equal(res.status, 200); assert.equal(JSON.parse(res.body).customerReady, false);
});
test('failed setup closes pool and returns no server', async () => {
  let closed = false;
  await assert.rejects(runStagingSetupMode({ env: env(), listen: false,
    poolFactory: async () => ({ end: async () => { closed = true; } }),
    setupSchema: async () => { throw new Error('synthetic_failure'); } }), /synthetic_failure/);
  assert.equal(closed, true);
});
test('setup listener is maintenance-only and never serves auth, customer data or voice routes', () => {
  const handle = createSetupMaintenanceHandler('a'.repeat(40));
  for (const url of ['/portal', '/api/auth/login', '/api/customer-portal/v1/session', '/openai/webhook', '/health?expanded=1']) {
    const res = response(); handle({ method: 'GET', url }, res);
    assert.equal(res.status, 503); assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(JSON.parse(res.body).providerActionsEnabled, false);
  }
  const res = response(); handle({ method: 'HEAD', url: '/health' }, res);
  assert.equal(res.status, 200); assert.equal(res.body, undefined);
});
test('existing lab maintenance gate remains before opt-in setup, with normal preflight after it', async () => {
  const source = await readFile(new URL('../../scripts/private-voice-lab-start.mjs', import.meta.url), 'utf8');
  assert.ok(source.indexOf('if (labMaintenanceEnabled(env))') < source.indexOf('env.PORTAL_STAGING_SETUP'));
  assert.match(source, /runStagingSetupMode\(\{ env \}\)/);
});
