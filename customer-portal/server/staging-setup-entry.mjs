import http from 'node:http';
import { stagingRuntimeConfig, STAGING_SERVICE } from './staging-runtime.mjs';

export const STAGING_SETUP_ID = 'bookedradar-portal-staging-v1';
export function setupModeRequested(env = {}) {
  if (env.PORTAL_STAGING_SETUP === undefined || env.PORTAL_STAGING_SETUP === 'false') return false;
  if (env.PORTAL_STAGING_SETUP !== STAGING_SETUP_ID) throw new Error('portal_staging_setup_id_invalid');
  return true;
}

export function createSetupMaintenanceHandler(commit = null) {
  const body = JSON.stringify({ status: 'maintenance', mode: 'portal_staging_setup_complete',
    customerReady: false, providerActionsEnabled: false, service: STAGING_SERVICE,
    commit: /^[a-f0-9]{40}$/.test(commit || '') ? commit : null });
  return (req, res) => {
    const health = ['GET', 'HEAD'].includes(req.method) && req.url === '/health';
    res.writeHead(health ? 200 : 503, { 'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store', 'connection': 'close', 'x-content-type-options': 'nosniff',
      ...(health ? {} : { 'retry-after': '60' }) });
    res.end(req.method === 'HEAD' ? undefined : body);
  };
}

/** Explicit setup-only deployment: never imports the existing app or serves auth. */
export async function runStagingSetupMode({ env = process.env, poolFactory, setupSchema, listen = true } = {}) {
  if (!setupModeRequested(env)) throw new Error('portal_staging_setup_opt_in_required');
  const config = stagingRuntimeConfig(env);
  if (!config) throw new Error('portal_staging_setup_disabled');
  const port = env.PORT === undefined ? '5050' : env.PORT;
  if (!/^[1-9]\d{0,4}$/.test(port) || Number(port) > 65535) throw new Error('portal_staging_port_invalid');
  const factory = poolFactory || (async options => { const { Pool } = await import('pg'); return new Pool(options); });
  const pool = await factory({ connectionString: config.connectionString, max: 1, connectionTimeoutMillis: 3000,
    application_name: 'bookedradar-portal-staging-setup' });
  try {
    const run = setupSchema || (await import('./staging-schema-setup.mjs')).setupStagingSchema;
    await run({ config, pool });
  } finally { await pool.end(); }
  const handler = createSetupMaintenanceHandler(env.RENDER_GIT_COMMIT);
  if (!listen) return { handler };
  const server = http.createServer(handler);
  server.requestTimeout = 10000; server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(Number(port), '0.0.0.0', resolve); });
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => server.close(() => process.exit(0)));
  console.log(JSON.stringify({ event: 'portal_staging.setup_complete', service: STAGING_SERVICE, customerReady: false, providerActionsEnabled: false }));
  return server;
}
