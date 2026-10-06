import { verifyPostgresReleaseSchema } from './postgres-schema-inspection.js';
import { createPostgresPool,postgresHealth } from './postgres-runtime.js';
import { PostgresCallStateStore,PostgresWebhookStore,PostgresAttemptStore } from './postgres-state-store.js';
import { PostgresCallHistoryStore } from './postgres-call-history.js';
import { PostgresRecoveryStore,readRecovery } from './postgres-recovery-store.js';
import { PostgresWebChatStore,PostgresTransferStore,PostgresGrowthMetricsStore } from './postgres-aux-stores.js';
import { PostgresLeadStore } from './postgres-lead-store.js';
import { PostgresBillingStore } from './billing/postgres-store.js';
import { persistPostgresVoiceLead,persistPostgresChatTurn } from './postgres-intake-workflows.js';
import { CallHistoryStore } from './call-history.js';
import { useJsonMemoryView } from './json-file-transaction.js';

const LOCALHOSTS = new Set(['localhost','127.0.0.1','[::1]']);

export function postgresLabConfig(env) {
  const backend=env.BOOKEDRADAR_STORAGE_BACKEND || 'json';
  if (backend==='json') return null;
  if (backend!=='postgres_lab') throw new Error('storage_backend_not_lab');
  const url=new URL(env.DATABASE_URL || '');
  if (!LOCALHOSTS.has(url.hostname) || url.pathname!=='/bookedradar_test' || !['postgres:','postgresql:'].includes(url.protocol)) throw new Error('postgres_lab_requires_disposable_database');
  if (['CRM_SMOKE_TEST_ON_STARTUP','EMAIL_SMOKE_TEST_ON_STARTUP','E2E_SMOKE_TEST_ON_STARTUP','TWILIO_A2P_DIAGNOSTIC_ON_STARTUP'].some(key=>env[key]==='true') || env.VOICE_ENABLED==='true' || env.DISPATCH_ENABLED==='true' || env.BOOKEDRADAR_BILLING_ENABLED==='true' || env.DEMO_NUMBER_PROVISION_MODE && env.DEMO_NUMBER_PROVISION_MODE!=='off' || ['OPENAI_API_KEY','TWILIO_AUTH_TOKEN','STRIPE_SECRET_KEY','RESEND_API_KEY','WIX_API_KEY'].some(key=>env[key])) throw new Error('postgres_lab_requires_providers_disabled');
  return {connectionString:env.DATABASE_URL,mode:'lab'};
}

export function postgresBackendConfig(env) {
  const backend=String(env.BOOKEDRADAR_STORAGE_BACKEND || 'json').trim();
  if (backend==='json') return null;
  if (backend==='postgres_lab') return postgresLabConfig(env);
  if (backend!=='postgres') throw new Error('storage_backend_not_released');
  if (String(env.POSTGRES_PRODUCTION_ARMED || 'false').toLowerCase()!=='true') {
    throw new Error('postgres_production_not_armed');
  }

  const connectionString=String(env.DATABASE_URL || '').trim();
  const url=new URL(connectionString);
  if (!['postgres:','postgresql:'].includes(url.protocol) || LOCALHOSTS.has(url.hostname) || url.pathname==='/bookedradar_test') {
    throw new Error('postgres_production_requires_managed_database');
  }

  const migrationId=String(env.POSTGRES_VALIDATED_MIGRATION_ID || '').trim();
  const snapshotFingerprint=String(env.POSTGRES_VALIDATED_SNAPSHOT_FINGERPRINT || '').trim().toLowerCase();
  if (!/^[a-zA-Z0-9_-]{8,160}$/.test(migrationId)) throw new Error('postgres_validated_migration_id_required');
  if (!/^[a-f0-9]{64}$/.test(snapshotFingerprint)) throw new Error('postgres_validated_snapshot_fingerprint_required');

  return {
    connectionString,
    mode:'production',
    migrationId,
    snapshotFingerprint,
  };
}

export function providerAdaptersEnabledForStorage(stores) {
  return !stores || stores.mode !== 'lab';
}

export function validateProductionCutoverSourceAudit(audit,expectedFingerprint) {
  if (!audit?.ok) throw new Error('postgres_cutover_source_audit_failed');
  if (
    String(audit.snapshotFingerprint || '').toLowerCase() !==
    String(expectedFingerprint || '').toLowerCase()
  ) {
    throw new Error('postgres_cutover_source_fingerprint_mismatch');
  }
  if (Number(audit.errorCount || 0) > 0 || Number(audit.warningCount || 0) > 0) {
    throw new Error('postgres_cutover_source_audit_not_clean');
  }
  return {
    ok:true,
    snapshotFingerprint:String(audit.snapshotFingerprint).toLowerCase(),
  };
}

export async function verifyValidatedProductionMigration(pool,{migrationId,snapshotFingerprint}={}) {
  const {rows}=await pool.query(
    `SELECT migration_id,source_snapshot_sha256,status,validation
       FROM bookedradar.migration_runs
      WHERE migration_id=$1`,
    [migrationId]
  );
  const row=rows[0];
  if (!row) throw new Error('postgres_validated_migration_missing');
  if (row.status!=='validated') throw new Error('postgres_validated_migration_status_invalid');
  if (String(row.source_snapshot_sha256 || '').toLowerCase()!==String(snapshotFingerprint || '').toLowerCase()) {
    throw new Error('postgres_validated_migration_fingerprint_mismatch');
  }
  const validation=row.validation || {};
  if (validation?.tableCounts?.ok!==true || validation?.content?.ok!==true) {
    throw new Error('postgres_validated_migration_reconciliation_invalid');
  }
  if (
    validation?.content?.sourceContentHash &&
    validation?.content?.postgresContentHash &&
    validation.content.sourceContentHash!==validation.content.postgresContentHash
  ) {
    throw new Error('postgres_validated_migration_content_hash_mismatch');
  }
  return {
    migrationId:row.migration_id,
    snapshotFingerprint:String(row.source_snapshot_sha256).toLowerCase(),
    validated:true,
  };
}

export async function createPostgresServerStores(config) {
  const pool=createPostgresPool(config);
  let productionValidation=null;
  let schemaValidation;
  try {
    await postgresHealth(pool);
    schemaValidation=await verifyPostgresReleaseSchema(pool);
    if (config?.mode==='production') {
      productionValidation=await verifyValidatedProductionMigration(pool,config);
    }
  } catch(error) {await pool.end();throw error;}
  const noop=async()=>{};
  // Lookup is for already-authenticated internal provider callbacks whose IDs
  // are globally unique. Tenant-facing APIs still pass explicit tenant IDs.
  async function owner(table,key,id) {
    const {rows}=await pool.query(`SELECT tenant_id FROM bookedradar.${table} WHERE ${key}=$1`,[id]);
    return rows[0]?.tenant_id || null;
  }
  const callOwner=id=>owner('call_control_state','call_id',id);
  const webhook=new PostgresWebhookStore(pool);
  const attempts=new PostgresAttemptStore(pool);
  const state={claimAttempt:(key,intent)=>attempts.claimAttempt(key,intent),finishAttempt:(key,patch)=>attempts.finishAttempt(key,patch),load:noop,hasInquiryReceipt:id=>webhook.hasInquiryReceipt(id),markInquiryOnce:id=>webhook.markInquiryOnce(id),markWebhookOnce:id=>webhook.markWebhookOnce(id),releaseWebhook:id=>webhook.releaseWebhook(id),
    getCall:async id=>{const tenant=await callOwner(id);return tenant ? new PostgresCallStateStore(pool,tenant).getCall(id) : null;},
    patchCall:async(id,patch)=>{const tenant=patch.tenantId || await callOwner(id);return new PostgresCallStateStore(pool,tenant).patchCall(id,patch);}};
  const callHistory={load:noop,get:(tenant,id)=>new PostgresCallHistoryStore(pool,tenant).get(id),start:(id,args)=>new PostgresCallHistoryStore(pool,args.tenantId).start(id,args)};
  for (const method of ['addTurn','addKnowledgeGap','finish','mark'])callHistory[method]=async(id,...args)=>{
    const tenant=await owner('voice_calls','call_id',id);return tenant ? new PostgresCallHistoryStore(pool,tenant)[method](id,...args) : null;
  };
  for (const method of ['list','stats','statsSince'])callHistory[method]=(tenant,...args)=>new PostgresCallHistoryStore(pool,tenant)[method](...args);
  callHistory.operationalSummary=async options=>{
    if (!options?.tenantId) {
      const {rows}=await pool.query('SELECT call_id,payload FROM bookedradar.voice_calls');
      const view=new CallHistoryStore('/unused/report.json');useJsonMemoryView(view);view.loaded=true;view.data={calls:Object.fromEntries(rows.map(r=>[r.call_id,r.payload]))};
      return view.operationalSummary(options);
    }
    return new PostgresCallHistoryStore(pool,options.tenantId).operationalSummary(options);
  };
  const forTenant=tenant=>new PostgresRecoveryStore(pool,tenant);
  const recovery={load:noop,forTenant,failedActions:tenant=>forTenant(tenant).failedActions(),
    snapshot:async()=>{
      const client=await pool.connect();
      try {await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const data=await readRecovery(client);await client.query('COMMIT');return data;}
      catch(error){try{await client.query('ROLLBACK');}catch{}throw error;}finally{client.release();}
    },
    upsertContact:(key,patch)=>forTenant(key.split(':')[0]).upsertContact(key,patch),
    scheduleAction:action=>forTenant(action.tenantId).scheduleAction(action),
    prune:async options=>{
      const {rows}=await pool.query('SELECT DISTINCT tenant_id FROM bookedradar.recovery_events WHERE tenant_id IS NOT NULL UNION SELECT DISTINCT tenant_id FROM bookedradar.recovery_actions');
      const total={deletedEvents:0,deletedActions:0};
      for(const row of rows){const r=await forTenant(row.tenant_id).prune(options);total.deletedEvents+=r.deletedEvents;total.deletedActions+=r.deletedActions;}
      return total;
    },
  };
  for(const [method,table,key] of [['getContact','recovery_contacts','contact_key'],['getOpportunity','recovery_opportunities','opportunity_id'],['patchOpportunity','recovery_opportunities','opportunity_id'],['patchAction','recovery_actions','action_id']])recovery[method]=async(id,...args)=>{
    const tenant=await owner(table,key,id);if(!tenant){if(method.startsWith('get'))return null;throw new Error('record_not_found');}return forTenant(tenant)[method](id,...args);
  };
  const webChat={load:noop,getOrCreate:(tenant,id)=>new PostgresWebChatStore(pool,tenant).getOrCreate(id),
    update:async(id,patch,options)=>{const tenant=await owner('web_chat_sessions','session_id',id);return new PostgresWebChatStore(pool,tenant).update(id,patch,options);}};
  const transfers={load:noop,getCall:async id=>{const tenant=await owner('transfer_records','transfer_id',id);return tenant ? new PostgresTransferStore(pool,tenant).getCall(id) : null;},
    patchCall:async(id,patch)=>{const tenant=patch.tenantId || await owner('transfer_records','transfer_id',id);return new PostgresTransferStore(pool,tenant).patchCall(id,patch);}};
  return {pool,mode:config?.mode || 'lab',productionValidation,schemaValidation,state,callHistory,recovery,webChat,transfers,growth:new PostgresGrowthMetricsStore(pool),
    persistVoiceLead:args=>persistPostgresVoiceLead(pool,args),persistChatTurn:args=>persistPostgresChatTurn(pool,args),
    appendLead:lead=>new PostgresLeadStore(pool,lead.tenant_id).append(lead),
    billingStore:mode=>new PostgresBillingStore(pool,{mode}),close:()=>pool.end()};
}

