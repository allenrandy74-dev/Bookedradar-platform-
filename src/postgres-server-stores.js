import { createPostgresPool,postgresHealth } from './postgres-runtime.js';
import { PostgresCallStateStore,PostgresWebhookStore } from './postgres-state-store.js';
import { PostgresCallHistoryStore } from './postgres-call-history.js';
import { PostgresRecoveryStore,readRecovery } from './postgres-recovery-store.js';
import { PostgresWebChatStore,PostgresTransferStore,PostgresGrowthMetricsStore } from './postgres-aux-stores.js';
import { PostgresLeadStore } from './postgres-lead-store.js';
import { PostgresBillingStore } from './billing/postgres-store.js';

// Only the isolated application lab is selectable in this release. Production
// activation is deliberately rejected until load/drain/backup gates are proven.
export function postgresLabConfig(env) {
  const backend=env.BOOKEDRADAR_STORAGE_BACKEND || 'json';
  if (backend==='json') return null;
  if (backend!=='postgres_lab') throw new Error('storage_backend_not_released');
  const url=new URL(env.DATABASE_URL || '');
  if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname) || url.pathname!=='/bookedradar_test' || !['postgres:','postgresql:'].includes(url.protocol)) throw new Error('postgres_lab_requires_disposable_database');
  if (['CRM_SMOKE_TEST_ON_STARTUP','EMAIL_SMOKE_TEST_ON_STARTUP','E2E_SMOKE_TEST_ON_STARTUP','TWILIO_A2P_DIAGNOSTIC_ON_STARTUP'].some(key=>env[key]==='true') || env.VOICE_ENABLED==='true' || env.DISPATCH_ENABLED==='true' || env.BOOKEDRADAR_BILLING_ENABLED==='true' || env.DEMO_NUMBER_PROVISION_MODE && env.DEMO_NUMBER_PROVISION_MODE!=='off' || ['OPENAI_API_KEY','TWILIO_AUTH_TOKEN','STRIPE_SECRET_KEY','RESEND_API_KEY','WIX_API_KEY'].some(key=>env[key])) throw new Error('postgres_lab_requires_providers_disabled');
  return {connectionString:env.DATABASE_URL};
}

export async function createPostgresServerStores(config) {
  const pool=createPostgresPool(config);
  try {await postgresHealth(pool);} catch(error) {await pool.end();throw error;}
  const noop=async()=>{};
  // Lookup is for already-authenticated internal provider callbacks whose IDs
  // are globally unique. Tenant-facing APIs still pass explicit tenant IDs.
  async function owner(table,key,id) {
    const {rows}=await pool.query(`SELECT tenant_id FROM bookedradar.${table} WHERE ${key}=$1`,[id]);
    return rows[0]?.tenant_id || null;
  }
  const callOwner=id=>owner('call_control_state','call_id',id);
  const webhook=new PostgresWebhookStore(pool);
  const state={load:noop,markWebhookOnce:id=>webhook.markWebhookOnce(id),releaseWebhook:id=>webhook.releaseWebhook(id),
    getCall:async id=>{const tenant=await callOwner(id);return tenant ? new PostgresCallStateStore(pool,tenant).getCall(id) : null;},
    patchCall:async(id,patch)=>{const tenant=patch.tenantId || await callOwner(id);return new PostgresCallStateStore(pool,tenant).patchCall(id,patch);}};
  const callHistory={load:noop,get:(tenant,id)=>new PostgresCallHistoryStore(pool,tenant).get(id),start:(id,args)=>new PostgresCallHistoryStore(pool,args.tenantId).start(id,args)};
  for (const method of ['addTurn','addKnowledgeGap','finish','mark'])callHistory[method]=async(id,...args)=>{
    const tenant=await owner('voice_calls','call_id',id);return tenant ? new PostgresCallHistoryStore(pool,tenant)[method](id,...args) : null;
  };
  for (const method of ['list','stats','statsSince'])callHistory[method]=(tenant,...args)=>new PostgresCallHistoryStore(pool,tenant)[method](...args);
  callHistory.operationalSummary=async options=>{
    if (!options?.tenantId) throw new Error('tenant_id_required');
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
    prune:async()=>{throw new Error('postgres_retention_not_released');},
  };
  for(const [method,table,key] of [['getContact','recovery_contacts','contact_key'],['getOpportunity','recovery_opportunities','opportunity_id'],['patchOpportunity','recovery_opportunities','opportunity_id'],['patchAction','recovery_actions','action_id']])recovery[method]=async(id,...args)=>{
    const tenant=await owner(table,key,id);if(!tenant){if(method.startsWith('get'))return null;throw new Error('record_not_found');}return forTenant(tenant)[method](id,...args);
  };
  const webChat={load:noop,getOrCreate:(tenant,id)=>new PostgresWebChatStore(pool,tenant).getOrCreate(id),
    update:async(id,patch,options)=>{const tenant=await owner('web_chat_sessions','session_id',id);return new PostgresWebChatStore(pool,tenant).update(id,patch,options);}};
  const transfers={load:noop,getCall:async id=>{const tenant=await owner('transfer_records','transfer_id',id);return tenant ? new PostgresTransferStore(pool,tenant).getCall(id) : null;},
    patchCall:async(id,patch)=>{const tenant=patch.tenantId || await owner('transfer_records','transfer_id',id);return new PostgresTransferStore(pool,tenant).patchCall(id,patch);}};
  return {pool,state,callHistory,recovery,webChat,transfers,growth:new PostgresGrowthMetricsStore(pool),
    appendLead:lead=>new PostgresLeadStore(pool,lead.tenant_id).append(lead),
    billingStore:mode=>new PostgresBillingStore(pool,{mode}),close:()=>pool.end()};
}
