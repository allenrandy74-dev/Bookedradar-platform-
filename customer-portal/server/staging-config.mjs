export const STAGING = Object.freeze({
  deploymentName: 'bookedradar-private-voice-lab-20260929',
  origin: 'https://bookedradar-private-voice-lab-20260929.onrender.com',
  schema: 'bookedradar_portal_staging',
  wixClientId: 'f6191cf3-548f-4883-98a4-27cdd0fcff3a',
  wixSiteId: 'dc96494e-5565-41be-8513-deeeedcf59d7',
  databaseName: 'bookedradar_private_voice_lab_20260929',
  databaseScope: 'existing-lab',
});
const ENV_KEYS = { deploymentName: 'PORTAL_STAGING_DEPLOYMENT_NAME', origin: 'PORTAL_STAGING_ORIGIN', schema: 'PORTAL_STAGING_SCHEMA', wixClientId: 'PORTAL_STAGING_WIX_CLIENT_ID', wixSiteId: 'PORTAL_STAGING_WIX_SITE_ID', databaseName: 'PORTAL_STAGING_DATABASE_NAME', databaseScope: 'PORTAL_STAGING_DATABASE_SCOPE' };
export function assertStagingConfig(config) {
  if (config?.enabled !== true || Object.entries(STAGING).some(([key, value]) => config[key] !== value)) throw new Error('staging_configuration_required');
  return Object.freeze({ enabled: true, ...STAGING });
}
export function validateStagingConfig(env = {}) {
  const config = { enabled: env.PORTAL_STAGING_ENABLED === 'true' };
  for (const [key, envKey] of Object.entries(ENV_KEYS)) config[key] = env[envKey];
  return assertStagingConfig(config);
}
/** No connection is opened here. On first use, verify the existing internal lab DB. */
export function guardStagingPool(pool, config) {
  assertStagingConfig(config);
  if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') throw new Error('staging_pool_required');
  let verification;
  const verify = () => {
    if (!verification) verification = pool.query('SELECT current_database() AS name').then(result => {
      if (result.rows?.[0]?.name !== config.databaseName) throw new Error('staging_database_mismatch');
    });
    return verification;
  };
  return Object.freeze({ query: async (...args) => { await verify(); return pool.query(...args); }, connect: async () => { await verify(); return pool.connect(); } });
}
