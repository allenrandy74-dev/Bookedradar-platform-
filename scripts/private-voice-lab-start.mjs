import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPostgresPool } from '../src/postgres-runtime.js';
import { runPostgresShadowMigration } from './postgres-shadow-migrate.mjs';

export const LAB_NAME = 'bookedradar-private-voice-lab-20260929';
export const LAB_DATABASE = 'bookedradar_private_voice_lab_20260929';
const MIGRATION_ID = 'private_voice_lab_empty_20260929';
export const CRAFTS = ['hvac', 'plumbing', 'electrical', 'roofing', 'home-services'];
const PUBLIC_NUMBERS = ['+14092574186', '+14095477916', '+14092139980', '+14092321112', '+14092304297'];

export function validateLabEnvironment(env) {
  if (env.PRIVATE_VOICE_LAB !== 'true' || env.RENDER_SERVICE_NAME !== LAB_NAME) throw new Error('private_lab_service_required');
  const url = new URL(env.DATABASE_URL || '');
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      url.hostname !== env.PRIVATE_VOICE_LAB_DATABASE_HOST ||
      !/^dpg-[a-z0-9-]+$/.test(url.hostname) || url.pathname !== `/${LAB_DATABASE}`) {
    throw new Error('private_lab_database_required');
  }
  const forbidden = Object.entries(env).filter(([key, value]) => value && (
    /(?:TWILIO_AUTH_TOKEN|WIX_API_KEY|RESEND_API_KEY|STRIPE_.*KEY|HUMAN_TRANSFER_NUMBER)/.test(key) ||
    (/(?:SMOKE_TEST|DIAGNOSTIC|MIGRATION|ROLLBACK).*ON_STARTUP/.test(key) && value === 'true') ||
    (['DISPATCH_ENABLED','BOOKEDRADAR_BILLING_ENABLED','OPS_ALERTS_ENABLED'].includes(key) && value === 'true')
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

export async function initializeLabDatabase(pool, root, databaseUrl) {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('private_voice_lab_bootstrap'))");
    const schema = await client.query("SELECT to_regclass('bookedradar.migration_runs') AS table_name");
    if (schema.rows[0].table_name) {
      const existing = await client.query('SELECT source_snapshot_sha256,status FROM bookedradar.migration_runs WHERE migration_id=$1',[MIGRATION_ID]);
      if (existing.rows[0]?.status === 'validated') return existing.rows[0].source_snapshot_sha256;
      // An existing, unrecognized database must never be initialized over.
      throw new Error('private_lab_database_not_fresh');
    }
    const migrationEnv = {DATABASE_URL:databaseUrl,POSTGRES_MIGRATION_ID:MIGRATION_ID,POSTGRES_MIGRATION_ARMED:'true',POSTGRES_MIGRATION_DRY_RUN:'false'};
    const fixtures = {
      STATE_FILE:['state.json',{processedWebhooks:{},calls:{}}],
      RECOVERY_STATE_FILE:['recovery.json',{opportunities:{},actions:{},events:[],eventKeys:{},contacts:{},attribution:{}}],
      CALL_HISTORY_FILE:['history.json',{calls:{}}],
      WEB_CHAT_STATE_FILE:['chat.json',{sessions:{}}],
      GROWTH_METRICS_FILE:['growth.json',{counts:{},updatedAt:null}],
    };
    for(const [key,[filename,data]] of Object.entries(fixtures)) {
      migrationEnv[key]=path.join(root,filename);
      await fs.writeFile(migrationEnv[key],JSON.stringify(data));
    }
    migrationEnv.LEADS_FILE=path.join(root,'leads.jsonl');
    await fs.writeFile(migrationEnv.LEADS_FILE,'');
    await fs.writeFile(path.join(root,'voice-transfers.json'),JSON.stringify({processedWebhooks:{},calls:{}}));
    const migration=await runPostgresShadowMigration(migrationEnv);
    if(!migration.ok || migration.stage!=='validated_shadow') throw new Error(`private_lab_bootstrap_${migration.stage}_failed`);
    return migration.audit.snapshotFingerprint;
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('private_voice_lab_bootstrap'))").catch(()=>{});
    client.release();
  }
}

export async function main(env = process.env) {
  const numbers=validateLabEnvironment(env);
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'bookedradar-private-lab-'));
  const configDir=path.join(root,'tenants');await fs.mkdir(configDir);
  for(const craft of CRAFTS) {
    const source=JSON.parse(await fs.readFile(new URL(`../config/tenants/demo-${craft}.json`,import.meta.url),'utf8'));
    await fs.writeFile(path.join(configDir,`${craft}.json`),JSON.stringify(isolateTenant(source,craft,numbers[craft])));
  }
  const pool=createPostgresPool({connectionString:env.DATABASE_URL});
  let fingerprint;
  try {fingerprint=await initializeLabDatabase(pool,root,env.DATABASE_URL);} finally {await pool.end();}
  Object.assign(env,{
    NODE_ENV:'production',TENANT_CONFIG_DIR:configDir,BOOKEDRADAR_STORAGE_BACKEND:'postgres',
    POSTGRES_PRODUCTION_ARMED:'true',POSTGRES_STATELESS_MODE:'true',POSTGRES_VALIDATED_MIGRATION_ID:MIGRATION_ID,
    POSTGRES_VALIDATED_SNAPSHOT_FINGERPRINT:fingerprint,DISPATCH_ENABLED:'false',BOOKEDRADAR_BILLING_ENABLED:'false',
    OPS_ALERTS_ENABLED:'false',DEMO_NUMBER_PROVISION_MODE:'off',LOG_TRANSCRIPTS:'false',WARM_TRANSFER_ENABLED:'false',
  });
  console.log(JSON.stringify({event:'private_voice_lab.ready',tenants:CRAFTS.length,voiceEnabled:env.VOICE_ENABLED==='true',isolatedDatabase:true}));
  await import('../server.js');
}

if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error=>{console.error(JSON.stringify({event:'private_voice_lab.failed',error:String(error.message).replace(/(?:postgres(?:ql)?:\/\/|sk-)[^\s]+/g,'[redacted]')}));process.exitCode=1;});
}
