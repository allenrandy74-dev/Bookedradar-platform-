import { readFile } from 'node:fs/promises';

export const STAGING_ORIGIN = 'https://bookedradar-private-voice-lab-20260929.onrender.com';
export const STAGING_SERVICE = 'bookedradar-private-voice-lab-20260929';
export const STAGING_DATABASE = 'bookedradar_private_voice_lab_20260929';
export const STAGING_DATABASE_HOST = 'dpg-datimd2d0e5s73c926tg-a';
export const STAGING_SCHEMA = 'bookedradar_portal_staging';
const requireValue = (ok, message) => { if (!ok) throw new Error(message); };

/** Configuration is inert by default and cannot be repointed to production. */
export function stagingRuntimeConfig(env = {}) {
  if (env.PORTAL_STAGING_ENABLED === undefined || env.PORTAL_STAGING_ENABLED === 'false') return null;
  requireValue(env.PORTAL_STAGING_ENABLED === 'true', 'portal_staging_flag_invalid');
  requireValue(env.PRIVATE_VOICE_LAB === 'true' && env.RENDER_SERVICE_NAME === STAGING_SERVICE, 'portal_staging_service_required');
  requireValue(env.PRIVATE_VOICE_LAB_MAINTENANCE !== 'true', 'portal_staging_maintenance_conflict');
  requireValue(env.PORTAL_STAGING_ORIGIN === STAGING_ORIGIN, 'portal_staging_origin_required');
  for (const key of ['VOICE_ENABLED', 'DISPATCH_ENABLED', 'BOOKEDRADAR_BILLING_ENABLED', 'OPS_ALERTS_ENABLED', 'WARM_TRANSFER_ENABLED']) {
    requireValue(env[key] === 'false', 'portal_staging_providers_must_be_disabled');
  }
  requireValue(env.DEMO_NUMBER_PROVISION_MODE === 'off', 'portal_staging_provisioning_must_be_disabled');
  requireValue(!Object.entries(env).some(([key, value]) => key.endsWith('_ON_STARTUP') && value !== 'false'), 'portal_staging_startup_actions_must_be_disabled');
  let connection;
  try { connection = new URL(env.DATABASE_URL); } catch { throw new Error('portal_staging_database_required'); }
  requireValue(['postgres:', 'postgresql:'].includes(connection.protocol) &&
    connection.hostname === STAGING_DATABASE_HOST && env.PRIVATE_VOICE_LAB_DATABASE_HOST === STAGING_DATABASE_HOST &&
    connection.pathname === `/${STAGING_DATABASE}` && !connection.search && !connection.hash &&
    (!connection.port || connection.port === '5432'), 'portal_staging_database_required');
  connection.port = '5432';
  return Object.freeze({ enabled: true, deploymentName: STAGING_SERVICE, origin: STAGING_ORIGIN,
    schema: STAGING_SCHEMA, databaseName: STAGING_DATABASE, databaseScope: 'existing-lab',
    wixClientId: 'f6191cf3-548f-4883-98a4-27cdd0fcff3a', wixSiteId: 'dc96494e-5565-41be-8513-deeeedcf59d7',
    connectionString: connection.href });
}

const ASSETS = new Map([
  ['/portal', ['staging-index.html', 'text/html; charset=utf-8']],
  ['/portal/', ['staging-index.html', 'text/html; charset=utf-8']],
  ...['staging-app.mjs', 'client.mjs', 'staging-styles.css', 'styles.css'].map(file => [
    `/portal/assets/${file}`, [file, file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8'],
  ]),
]);
const API_PREFIX = '/api/customer-portal/v1';
const AUTH_PREFIX = '/api/auth';
const inside = (path, prefix) => path === prefix || path.startsWith(`${prefix}/`);
export const isStagingPath = path => inside(path, '/portal') || inside(path, API_PREFIX) || inside(path, AUTH_PREFIX);
const STATIC_HEADERS = {
  'cache-control': 'no-store, private', 'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};
const respond = (res, status, body) => { res.writeHead(status, { ...STATIC_HEADERS, 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };

/** Mount only before body parsing. No schema setup, enrollment or provider dispatch. */
export function createStagingMiddleware({ config, authHandler, portalHandler, readAsset = name => readFile(new URL(`../${name}`, import.meta.url)) }) {
  requireValue(config?.origin === STAGING_ORIGIN && config?.deploymentName === STAGING_SERVICE, 'portal_staging_config_required');
  requireValue(typeof authHandler === 'function' && typeof portalHandler === 'function', 'portal_staging_handlers_required');
  return async function middleware(req, res, next) {
    let path;
    try { path = new URL(req.url, STAGING_ORIGIN).pathname; } catch { return next(); }
    if (!isStagingPath(path)) return next();
    // Host is exact; never use caller-selected Forwarded/Host values to construct URLs.
    if (req.headers.host !== new URL(STAGING_ORIGIN).host || req.headers['x-forwarded-proto'] !== 'https') {
      return respond(res, 400, { ok: false, error: 'invalid_staging_origin' });
    }
    try {
      if (inside(path, AUTH_PREFIX)) {
        const handled = await authHandler(req, res);
        if (handled === false && !res.headersSent) respond(res, 404, { ok: false, error: 'not_found' });
        return;
      }
      if (inside(path, API_PREFIX)) return await portalHandler(req, res);
      const entry = ASSETS.get(path);
      if (!entry) return respond(res, 404, { ok: false, error: 'not_found' });
      if (!['GET', 'HEAD'].includes(req.method)) return respond(res, 405, { ok: false, error: 'method_not_allowed' });
      const bytes = await readAsset(entry[0]);
      res.writeHead(200, { ...STATIC_HEADERS, 'content-type': entry[1] });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch { if (!res.headersSent) respond(res, 503, { ok: false, error: 'staging_unavailable' }); }
  };
}

export async function createStagingRuntime({ env = process.env, poolFactory } = {}) {
  const config = stagingRuntimeConfig(env);
  if (!config) return null;
  requireValue(env.PORTAL_STAGING_SETUP === undefined || env.PORTAL_STAGING_SETUP === 'false', 'portal_staging_setup_requires_setup_only_entry');
  const factory = poolFactory || (async options => { const { Pool } = await import('pg'); return new Pool(options); });
  const pool = await factory({ connectionString: config.connectionString, max: 4, connectionTimeoutMillis: 3000, idleTimeoutMillis: 10000, application_name: 'bookedradar-portal-staging' });
  try {
    const { assertStagingSchemaReady } = await import('./staging-schema-readiness.mjs');
    await assertStagingSchemaReady({ config, pool });
    const { createStagingAuthHandler } = await import('./staging-auth.mjs');
    const { createCustomerPortalHandler } = await import('./api.mjs');
    const auth = await createStagingAuthHandler({ config, pool });
    const portalHandler = createCustomerPortalHandler({ store: auth.portalStore, resolveSession: auth.resolveSession, allowedOrigins: [config.origin] });
    return { middleware: createStagingMiddleware({ config, authHandler: auth.handler, portalHandler }), close: () => pool.end() };
  } catch (error) { await pool.end(); throw new Error('portal_staging_startup_failed'); }
}
