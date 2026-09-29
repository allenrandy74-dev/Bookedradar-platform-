import { RecoveryStore } from './recovery/store.js';
import { RecoveryEngine } from './recovery/engine.js';

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
    const { rows } = await client.query(`SELECT ${pk} AS id,payload FROM bookedradar.${table}${tenantId === null ? '' : ' WHERE tenant_id=$1'} ORDER BY ${pk}`, tenantId === null ? [] : [tenantId]);
    for (const row of rows) {
      if (key === 'events') { data.events.push(row.payload); const eventKey = row.payload.idempotencyKey || row.payload.id; if (eventKey) data.eventKeys[eventKey] = row.id; }
      else Object.defineProperty(data[key], row.id, { value:row.payload, enumerable:true, writable:true, configurable:true });
    }
  }
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
      await client.query('COMMIT'); return result;
    } catch (error) { try { await client.query('ROLLBACK'); } catch {} throw error; }
    finally { client.release(); }
  }
  // Persist an entire engine ingestion, not just its first event receipt.
  ingest(event, tenant) {
    if (tenant?.tenantId !== this.tenantId || (event.tenantId && event.tenantId !== this.tenantId)) throw new Error('recovery_tenant_conflict');
    return this.#transaction(store => new RecoveryEngine({ store, tenant }).ingest({ ...event,tenantId:this.tenantId }));
  }
  snapshot() { return this.#transaction(store => store.snapshot(), false); }
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
    return this.#transaction(store => Object.values(store.data.actions).filter(action => ['dispatching','reconciliation_required'].includes(action.status)), false);
  }
  cancelPendingActions(id, options) { return this.#transaction(store => store.cancelPendingActions(id, options)); }
}
