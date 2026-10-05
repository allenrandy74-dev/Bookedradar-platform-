import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import http from 'node:http';

export const LAB_NAME = 'bookedradar-private-voice-lab-20260929';
export const LAB_DATABASE = 'bookedradar_private_voice_lab_20260929';
const MIGRATION_ID = 'private_voice_lab_empty_20260929';
export const CRAFTS = ['hvac', 'plumbing', 'electrical', 'roofing', 'home-services'];
const PUBLIC_NUMBERS = ['+14092574186', '+14095477916', '+14092139980', '+14092321112', '+14092304297'];

export function validateLabEnvironment(env) {
  if (env.PRIVATE_VOICE_LAB !== 'true' || env.RENDER_SERVICE_NAME !== LAB_NAME) throw new Error('private_lab_service_required');
  const url = new URL(env.DATABASE_URL || '');
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.search || url.hash || (url.port && url.port !== '5432') ||
      url.hostname !== env.PRIVATE_VOICE_LAB_DATABASE_HOST ||
      !/^dpg-[a-z0-9-]+$/.test(url.hostname) || url.pathname !== `/${LAB_DATABASE}`) {
    throw new Error('private_lab_database_required');
  }
  const forbidden = Object.entries(env).filter(([key, value]) => value && (
    /(?:TWILIO_AUTH_TOKEN|WIX_API_KEY|RESEND_API_KEY|STRIPE_.*KEY|HUMAN_TRANSFER_NUMBER)/.test(key) ||
    (/(?:SMOKE_TEST|DIAGNOSTIC|MIGRATION|ROLLBACK|SHADOW_IMPORT|RESTORE_DRILL).*ON_STARTUP/.test(key) && String(value).trim().toLowerCase() === 'true') ||
    (['DISPATCH_ENABLED','BOOKEDRADAR_BILLING_ENABLED','OPS_ALERTS_ENABLED'].includes(key) && String(value).trim().toLowerCase() === 'true')
  ));
  if (forbidden.length) throw new Error('private_lab_external_integration_forbidden');
  if (env.OPENAI_PROJECT_ID !== 'proj_O0Mk7nAzTfe0AIys8Ukwd1cn') throw new Error('private_lab_openai_project_required');
  const numbers = JSON.parse(env.PRIVATE_VOICE_LAB_NUMBERS || '{}');
  if (env.VOICE_ENABLED === 'true') {
    const entries = Object.entries(numbers);
    if (!entries.length) throw new Error('private_lab_route_required');
    if (entries.some(([craft]) => !CRAFTS.includes(craft))) throw new Error('private_lab_unknown_route');
    const privateNumbers = entries.map(([, number]) => String(number || ''));
    if (privateNumbers.some(number => !/^\+[1-9]\d{7,14}$/.test(number))) throw new Error('private_lab_route_invalid');
    if (privateNumbers.some(number => PUBLIC_NUMBERS.includes(number))) throw new Error('public_demo_target_forbidden');
    if (new Set(privateNumbers).size !== privateNumbers.length) throw new Error('duplicate_synthetic_target');
    if (!env.OPENAI_API_KEY || !env.OPENAI_WEBHOOK_SECRET) throw new Error('private_lab_voice_credentials_required');
  } else if (env.VOICE_ENABLED !== 'false') throw new Error('private_lab_voice_flag_required');
  return numbers;
}

export function labDatabaseConnectionString(env) {
  validateLabEnvironment(env);
  const url = new URL(env.DATABASE_URL);
  // node-postgres parses connectionString after pool options. Explicitly pin
  // the URL port so ambient PGPORT cannot redirect preflight or server traffic.
  url.port = '5432';
  return url.href;
}

export function protectedDemoNumbers(sources) {
  return [...new Set(sources.flatMap(source => source?.integrations?.phone?.inboundNumbers || [])
    .map(number => String(number || '').trim()).filter(Boolean))];
}

export function assertNoProtectedDemoRoutes(numbers, sources) {
  const protectedNumbers = new Set([...PUBLIC_NUMBERS, ...protectedDemoNumbers(sources)]);
  if (Object.values(numbers).some(number => protectedNumbers.has(String(number || '').trim()))) {
    throw new Error('public_demo_target_forbidden');
  }
}

export function isolateTenant(source, craft, inboundNumber) {
  const tenant = structuredClone(source);
  tenant.tenantId = `synthetic-${craft}`;
  tenant.businessName = `Private Test ${craft}`;
  tenant.secretsPrefix = `SYNTHETIC_${craft.replaceAll('-', '_').toUpperCase()}`;
  // Required by the tenant schema, deliberately not a dialable phone number.
  tenant.escalation = {...tenant.escalation, humanPhone:'disabled-private-lab', urgentAfterHours:false};
  tenant.integrations = {phone:{type:'sip',enabled:Boolean(inboundNumber),inboundNumbers:inboundNumber?[inboundNumber]:[]}};
  for (const key of ['callerTexting','twoWaySms','webChat','reviewRadar','noShowGuard','membershipRadar']) {
    tenant.features[key] = false;
    if (tenant.commercial?.entitlements) tenant.commercial.entitlements[key] = false;
  }
  tenant.commercial = {...tenant.commercial,dispatchMode:'shadow',schedulingApproved:false};
  tenant.policies.sms = {allowTransactionalWhenInbound:false};
  return tenant;
}

export async function validateExistingLabDatabase(pool) {
  const { verifyValidatedProductionMigration } = await import('../src/postgres-server-stores.js');
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const schema = await client.query("SELECT to_regclass('bookedradar.migration_runs') AS table_name");
    if (!schema.rows[0].table_name) throw new Error('private_lab_existing_database_required');
    const {rows} = await client.query('SELECT source_snapshot_sha256 FROM bookedradar.migration_runs WHERE migration_id=$1', [MIGRATION_ID]);
    const fingerprint=String(rows[0]?.source_snapshot_sha256 || '');
    if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('private_lab_validated_migration_required');
    await verifyValidatedProductionMigration(client,{migrationId:MIGRATION_ID,snapshotFingerprint:fingerprint});
    await client.query('COMMIT');
    return fingerprint;
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  } finally {client.release();}
}

// Migration provenance alone does not prove compatibility with this release.
// Both checks are read-only; a failure must occur before server import/listen.
export async function validateLabReleaseReadiness(pool) {
  const fingerprint = await validateExistingLabDatabase(pool);
  const { verifyPostgresReleaseSchema } = await import('../src/postgres-schema-inspection.js');
  await verifyPostgresReleaseSchema(pool);
  return fingerprint;
}

// Only literal true opts in. Empty, whitespace, case variants and other values
// are configuration errors, not a silent return to application startup.
export function labMaintenanceEnabled(env) {
  const flag = env.PRIVATE_VOICE_LAB_MAINTENANCE;
  if (flag === undefined || flag === 'false') return false;
  if (flag !== 'true') throw new Error('private_lab_maintenance_flag_invalid');
  return true;
}

export function validateLabMaintenanceEnvironment(env) {
  validateLabEnvironment(env);
  if (!labMaintenanceEnabled(env)) throw new Error('private_lab_maintenance_required');
  for (const key of ['VOICE_ENABLED', 'DISPATCH_ENABLED', 'BOOKEDRADAR_BILLING_ENABLED', 'OPS_ALERTS_ENABLED', 'WARM_TRANSFER_ENABLED']) {
    if (env[key] !== 'false') throw new Error('private_lab_maintenance_providers_disabled_required');
  }
  if (env.DEMO_NUMBER_PROVISION_MODE !== 'off' ||
      Object.entries(env).some(([key, value]) => key.endsWith('_ON_STARTUP') && value !== 'false')) {
    throw new Error('private_lab_maintenance_actions_disabled_required');
  }
  const port = env.PORT === undefined ? '5050' : env.PORT;
  if (!/^[1-9]\d{0,4}$/.test(port) || Number(port) > 65535) throw new Error('private_lab_maintenance_port_invalid');
  return Number(port);
}

export async function startLabMaintenance(env) {
  const port = validateLabMaintenanceEnvironment(env);
  // Built-ins only: no config generation, application import, PostgreSQL client,
  // provider SDK, worker, readiness query or automatic migration in this branch.
  const body = JSON.stringify({status:'maintenance', mode:'private_lab_maintenance',
    customerReady:false, databaseReady:false, databaseAccess:'disabled', service:LAB_NAME,
    instanceId:env.RENDER_INSTANCE_ID || null, commit:env.RENDER_GIT_COMMIT || null});
  const server = http.createServer((request, response) => {
    const health = (request.method === 'GET' || request.method === 'HEAD') && request.url === '/health';
    response.writeHead(health ? 200 : 503, {'Content-Type':'application/json', 'Cache-Control':'no-store',
      'Connection':'close', ...(health ? {} : {'Retry-After':'60'})});
    response.end(request.method === 'HEAD' ? undefined : body);
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', resolve);
  });
  console.log(JSON.stringify({event:'private_voice_lab.maintenance_listening', port,
    customerReady:false, databaseAccess:'disabled', instanceId:env.RENDER_INSTANCE_ID || null,
    commit:env.RENDER_GIT_COMMIT || null}));
  return server;
}

export async function main(env = process.env) {
  if (labMaintenanceEnabled(env)) return startLabMaintenance(env);
  const numbers=validateLabEnvironment(env);
  const connectionString=labDatabaseConnectionString(env);
  const sources = await Promise.all(CRAFTS.map(async craft =>
    JSON.parse(await fs.readFile(new URL(`../config/tenants/demo-${craft}.json`,import.meta.url),'utf8'))));
  assertNoProtectedDemoRoutes(numbers, sources);
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'bookedradar-private-lab-'));
  const configDir=path.join(root,'tenants');await fs.mkdir(configDir);
  for(let i=0;i<CRAFTS.length;i++) {
    const craft=CRAFTS[i], source=sources[i];
    await fs.writeFile(path.join(configDir,`${craft}.json`),JSON.stringify(isolateTenant(source,craft,numbers[craft])));
  }
  const { createPostgresPool } = await import('../src/postgres-runtime.js');
  const pool=createPostgresPool({connectionString});
  let fingerprint;
  try {fingerprint=await validateLabReleaseReadiness(pool);} finally {await pool.end();}
  Object.assign(env,{
    DATABASE_URL:connectionString,NODE_ENV:'production',TENANT_CONFIG_DIR:configDir,BOOKEDRADAR_STORAGE_BACKEND:'postgres',
    POSTGRES_PRODUCTION_ARMED:'true',POSTGRES_STATELESS_MODE:'true',POSTGRES_VALIDATED_MIGRATION_ID:MIGRATION_ID,
    POSTGRES_VALIDATED_SNAPSHOT_FINGERPRINT:fingerprint,DISPATCH_ENABLED:'false',BOOKEDRADAR_BILLING_ENABLED:'false',
    OPS_ALERTS_ENABLED:'false',DEMO_NUMBER_PROVISION_MODE:'off',LOG_TRANSCRIPTS:'false',WARM_TRANSFER_ENABLED:'false',
  });
  console.log(JSON.stringify({event:'private_voice_lab.preflight_validated',tenants:CRAFTS.length,voiceEnabled:env.VOICE_ENABLED==='true',isolatedDatabase:true}));
  await import('../server.js');
}

if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error=>{console.error(JSON.stringify({event:'private_voice_lab.failed',error:String(error.message).replace(/(?:postgres(?:ql)?:\/\/|sk-)[^\s]+/g,'[redacted]')}));process.exitCode=1;});
}
