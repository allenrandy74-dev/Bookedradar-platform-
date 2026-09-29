import { RecoveryStore } from './recovery/store.js';
import { RecoveryEngine } from './recovery/engine.js';
import { stableHash } from './postgres-migration-audit.js';

export const RECOVERY_TABLES = [
  ['contacts','recovery_contacts','contact_key',{ updated_at:'updatedAt' }],
  ['opportunities','recovery_opportunities','opportunity_id',{ contact_key:'contactKey',status:'status',created_at:'createdAt',updated_at:'updatedAt' }],
  ['events','recovery_events','event_id',{ idempotency_key:'idempotencyKey',opportunity_id:'opportunityId',contact_key:'contactKey',occurred_at:'occurredAt' }],
  ['actions','recovery_actions','action_id',{ opportunity_id:'opportunityId',contact_key:'contactKey',channel:'channel',status:'status',due_at:'dueAt',claimed_by:'claimedBy',claimed_at:'claimedAt',claim_expires_at:'claimExpiresAt',created_at:'createdAt',completed_at:'completedAt' }],
  ['attribution','recovery_attribution','opportunity_id',{ updated_at:'updatedAt' }],
];

export async function readRecovery(client, tenantId = null) {
  const data = { contacts:{}, opportunities:{}, events:[], eventKeys:{}, actions:{}, attribution:{} };
  for (const [key,table,pk] of RECOVERY_TABLES) {
    const orderBy = key === 'events' ? 'source_sequence NULLS LAST, event_id' : pk;
    const { rows } = await client.query(`SELECT ${pk} AS id,payload FROM bookedradar.${table}${tenantId === null ? '' : ' WHERE tenant_id=$1'} ORDER BY ${orderBy}`, tenantId === null ? [] : [tenantId]);
    for (const row of rows) {
      if (key === 'events') data.events.push(row.payload);
      else Object.defineProperty(data[key], row.id, { value:row.payload, enumerable:true, writable:true, configurable:true });
    }
  }
  const keyRows = await client.query(
    `SELECT event_key,event_id FROM bookedradar.recovery_event_keys${tenantId === null ? '' : ' WHERE tenant_id=$1'} ORDER BY event_key`,
    tenantId === null ? [] : [tenantId]
  );
  for (const row of keyRows.rows) data.eventKeys[row.event_key] = row.event_id;
  return data;
}

export class PostgresRecoveryStore {
  constructor(pool, tenantId) {
    if (typeof tenantId !== 'string' || !tenantId.trim()) throw new Error('tenant_id_required');
    this.pool = pool; this.tenantId = tenantId;
  }
  async #transaction(fn, write = true) {
    const client = await this.pool.connect();
    try {
      await client.query(write ? 'BEGIN' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query("SET LOCAL lock_timeout='5s'");
      await client.query("SET LOCAL statement_timeout='15s'");
      if (write) await client.query("SELECT pg_advisory_xact_lock(hashtext('br_recovery'),hashtext($1))", [this.tenantId]);
      const store = new RecoveryStore('/unused/recovery.json');
      store.loaded = true; store.persist = async () => {};
      store.data = await readRecovery(client, this.tenantId);
      const before = structuredClone(store.data);
      const result = structuredClone(await fn(store));
      if (write) for (const [key,table,pk,fields] of RECOVERY_TABLES) {
        const entries = key === 'events' ? store.data.events.map(item => [item.id,item]) : Object.entries(store.data[key]);
        if (['events','actions'].includes(key)) {
          const currentIds=new Set(entries.map(([id])=>id));
          const priorIds=key==='events' ? before.events.map(e=>e.id) : Object.keys(before[key]);
          const removed=priorIds.filter(id=>!currentIds.has(id));
          if(removed.length)await client.query(`DELETE FROM bookedradar.${table} WHERE tenant_id=$1 AND ${pk}=ANY($2::text[])`,[this.tenantId,removed]);
        }
        for (const [id,item] of entries) {
          const previous = key === 'events' ? before.events.find(e => e.id === id) : before[key][id];
          if (JSON.stringify(previous) === JSON.stringify(item)) continue;
          const owner = item.tenantId || (key === 'contacts' && id.startsWith(this.tenantId + ':') ? this.tenantId : key === 'attribution' ? store.data.opportunities[id]?.tenantId : null);
          if (!id || owner !== this.tenantId) throw new Error('recovery_tenant_conflict');
          if (key !== 'events' && item.contactKey && !item.contactKey.startsWith(this.tenantId + ':')) throw new Error('recovery_contact_conflict');
          if (['actions','attribution'].includes(key) && item.opportunityId && !store.data.opportunities[item.opportunityId]) throw new Error('recovery_opportunity_conflict');
          const columns = [pk,'tenant_id',...Object.keys(fields),'payload'];
          const values = [id,this.tenantId,...Object.values(fields).map(field => item[field] ?? null),JSON.stringify(item)];
          const query = `INSERT INTO bookedradar.${table} AS existing (${columns.join(',')}) VALUES (${values.map((_,i)=>'$'+(i+1)).join(',')})
            ON CONFLICT (${pk}) DO UPDATE SET ${columns.slice(1).map(c=>`${c}=EXCLUDED.${c}`).join(',')}
            WHERE existing.tenant_id=EXCLUDED.tenant_id RETURNING ${pk}`;
          const changed = await client.query(query, values);
          if (!changed.rows.length) throw new Error('recovery_tenant_conflict');
        }
      }
      if (write) {
        await client.query('DELETE FROM bookedradar.recovery_event_keys WHERE tenant_id=$1', [this.tenantId]);
        const eventIds = new Set(store.data.events.map(event => event.id));
        for (const [eventKey,eventId] of Object.entries(store.data.eventKeys || {})) {
          if (!eventIds.has(eventId)) throw new Error('recovery_event_key_conflict');
          await client.query(
            'INSERT INTO bookedradar.recovery_event_keys(tenant_id,event_key,event_id) VALUES($1,$2,$3) ON CONFLICT(tenant_id,event_key) DO UPDATE SET event_id=EXCLUDED.event_id',
            [this.tenantId,eventKey,eventId]
          );
        }
      }
      await client.query('COMMIT'); return result;
    } catch (error) { try { await client.query('ROLLBACK'); } catch {} throw error; }
    finally { client.release(); }
  }
  // Persist an entire engine ingestion, not just its first event receipt.
  ingest(event, tenant) {
    if (tenant?.tenantId !== this.tenantId || (event.tenantId && event.tenantId !== this.tenantId)) throw new Error('recovery_tenant_conflict');
    return this.#transaction(store => new RecoveryEngine({ store, tenant }).ingest({ ...event,tenantId:this.tenantId }));
  }
  markRecovered(id, options, tenant) {
    if (tenant?.tenantId !== this.tenantId) throw new Error('recovery_tenant_conflict');
    return this.#transaction(store => new RecoveryEngine({store,tenant}).markRecovered(id,options));
  }
  evaluateDueActions(now, tenant) {
    if (tenant?.tenantId !== this.tenantId) throw new Error('recovery_tenant_conflict');
    return this.#transaction(store => new RecoveryEngine({store,tenant}).dueActions(now));
  }
  snapshot() { return this.#transaction(store => store.snapshot(), false); }
  upsertContact(key, patch) {
    if (!key.startsWith(this.tenantId+':') || (patch.tenantId && patch.tenantId!==this.tenantId)) throw new Error('recovery_tenant_conflict');
    return this.#transaction(store=>store.upsertContact(key,{...patch,tenantId:this.tenantId}));
  }
  patchOpportunity(id, patch) {
    if (['id','tenantId','contactKey'].some(k=>k in patch)) throw new Error('opportunity_structural_patch_forbidden');
    return this.#transaction(store=>store.patchOpportunity(id,patch));
  }
  scheduleAction(action) {
    if (action.tenantId!==this.tenantId) throw new Error('recovery_tenant_conflict');
    return this.#transaction(store=>store.scheduleAction(action));
  }
  patchAction(id,patch) {
    return this.#transaction(async store=>{
      const current=store.data.actions[id];
      if (!current) throw new Error('action_not_found');
      if (['processing','dispatching','reconciliation_required'].includes(current.status)) throw new Error('action_requires_fenced_completion');
      if (['id','tenantId','opportunityId','contactKey','claimedBy','claimedAt','claimExpiresAt'].some(k=>k in patch) || !['completed','failed','blocked','cancelled'].includes(patch.status)) throw new Error('action_patch_invalid');
      return store.patchAction(id,patch);
    });
  }
  failedActions() { return this.#transaction(store=>store.failedActions(this.tenantId),false); }
  prune(options={}) {
    const {now=new Date(),eventRetentionDays=90,actionRetentionDays=180}=options;
    if (![eventRetentionDays,actionRetentionDays].every(n=>Number.isFinite(n) && n>=1 && n<=3650) || !Number.isFinite(now.getTime())) throw new Error('retention_options_invalid');
    return this.#transaction(async store=>{
      const audit=store.data.events.filter(e=>e.type==='action_reconciled' && new Date(e.occurredAt).getTime()>=now.getTime()-actionRetentionDays*86400000);
      const result=await store.prune({now,eventRetentionDays,actionRetentionDays});
      for(const event of audit)if(!store.data.events.some(e=>e.id===event.id)){store.data.events.push(event);store.data.eventKeys[event.idempotencyKey || event.id]=event.id;result.deletedEvents--;}
      return result;
    });
  }
  getOpportunity(id) { return this.#transaction(store => store.getOpportunity(id), false); }
  getContact(id) { return this.#transaction(store => store.getContact(id), false); }
  claimDueActions(options = {}) {
    if (options.tenantId && options.tenantId !== this.tenantId) throw new Error('recovery_tenant_conflict');
    if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100)) throw new Error('claim_limit_invalid');
    if (options.leaseMs !== undefined && (!Number.isFinite(options.leaseMs) || options.leaseMs < 1000 || options.leaseMs > 3600000)) throw new Error('claim_lease_invalid');
    return this.#transaction(store => store.claimDueActions({ ...options,tenantId:this.tenantId }));
  }
  finishClaim(actionId, claim, patch, now = new Date()) {
    return this.#transaction(async store => {
      const current = store.data.actions[actionId];
      if (!current || !['processing','dispatching'].includes(current.status) || current.claimedBy !== claim?.claimedBy || current.claimedAt !== claim?.claimedAt || current.claimExpiresAt !== claim?.claimExpiresAt || !(new Date(current.claimExpiresAt) > now)) throw new Error('stale_recovery_claim');
      if (!['completed','failed','blocked','pending','reconciliation_required'].includes(patch?.status) || ['id','tenantId','claimedBy','claimedAt','claimExpiresAt','opportunityId','contactKey'].some(k => k in patch)) throw new Error('action_patch_invalid');
      if (current.status === 'dispatching' && patch.status === 'pending') throw new Error('dispatch_reconciliation_required');
      return store.patchAction(actionId, { ...patch,claimedBy:null,claimedAt:null,claimExpiresAt:null });
    });
  }
  beginDispatch(actionId, claim, now = new Date()) {
    return this.#transaction(async store => {
      const current = store.data.actions[actionId];
      if (!current || current.status !== 'processing' || current.claimedBy !== claim?.claimedBy || current.claimedAt !== claim?.claimedAt || current.claimExpiresAt !== claim?.claimExpiresAt || !(new Date(current.claimExpiresAt) > now)) throw new Error('stale_recovery_claim');
      // Expired processing claims are reclaimable. A dispatching action is not:
      // a provider may already have accepted it even if the process disappears.
      return store.patchAction(actionId, { status:'dispatching',dispatchStartedAt:now.toISOString() });
    });
  }
  reconciliationActions() {
    return this.#transaction(store => Object.values(store.data.actions).filter(action => ['dispatching','reconciliation_required'].includes(action.status)).map(action => ({...action,reconciliationRevision:stableHash(action)})), false);
  }
  reconcileAction(actionId, { decision,expectedRevision,resolutionId,evidence,actor } = {}, now = new Date()) {
    if (!['confirmed_sent','cancelled'].includes(decision)) throw new Error('reconciliation_decision_invalid');
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(resolutionId || '')) throw new Error('reconciliation_id_invalid');
    if (!/^[a-f0-9]{64}$/.test(expectedRevision || '')) throw new Error('reconciliation_revision_required');
    if (typeof actor !== 'string' || !actor.trim() || actor.length > 120) throw new Error('reconciliation_actor_required');
    if (typeof evidence !== 'string' || !evidence.trim() || evidence.length > 1000) throw new Error('reconciliation_evidence_required');
    return this.#transaction(async store => {
      const current=store.data.actions[actionId];
      if (!current) throw new Error('action_not_found');
      const key=`reconcile:${this.tenantId}:${resolutionId}`;
      const previous=store.data.events.find(event=>event.idempotencyKey===key);
      if (previous) {
        if (previous.actionId!==actionId || previous.decision!==decision || previous.evidence!==evidence || previous.actor!==actor) throw new Error('reconciliation_id_conflict');
        return {action:current,duplicate:true};
      }
      if (!['dispatching','reconciliation_required'].includes(current.status) || stableHash(current)!==expectedRevision) throw new Error('stale_reconciliation_revision');
      if (current.status==='dispatching' && current.claimExpiresAt && new Date(current.claimExpiresAt)>now) throw new Error('dispatch_still_active');
      const resolvedAt=now.toISOString();
      const action=await store.patchAction(actionId,{
        status:decision==='confirmed_sent' ? 'completed' : 'cancelled',
        completedAt:resolvedAt,claimedBy:null,claimedAt:null,claimExpiresAt:null,
        reconciliation:{decision,evidence,actor,resolutionId,resolvedAt},
      });
      await store.addEvent({tenantId:this.tenantId,idempotencyKey:key,type:'action_reconciled',actionId,opportunityId:current.opportunityId,decision,evidence,actor,resolutionId,occurredAt:resolvedAt});
      return {action,duplicate:false};
    });
  }
  cancelPendingActions(id, options) { return this.#transaction(store => store.cancelPendingActions(id, options)); }
}
