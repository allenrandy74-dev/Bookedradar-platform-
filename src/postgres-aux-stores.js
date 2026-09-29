import crypto from 'node:crypto';
import { normalizeGrowthEvent } from './growth-metrics.js';

function tenant(value) { if (typeof value !== 'string' || !value.trim()) throw new Error('tenant_id_required'); return value; }
const iso = ms => new Date(ms).toISOString();

// Fixed table names only; no caller-supplied SQL identifiers.
async function mutate(pool, table, pk, key, owner, create, fn) {
  if (typeof key !== 'string' || !key.trim()) throw new Error('record_id_required');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [table,key]);
    const { rows } = await client.query(`SELECT tenant_id,payload FROM bookedradar.${table} WHERE ${pk}=$1 FOR UPDATE`, [key]);
    if (rows.length && rows[0].tenant_id !== owner) throw new Error('record_tenant_conflict');
    if (!rows.length && !create) throw new Error('unknown_record');
    const data = await fn(rows[0]?.payload || null);
    if (data.tenantId !== owner) throw new Error('record_tenant_conflict');
    const chat = table === 'web_chat_sessions';
    const columns = chat ? ['session_id','tenant_id','opportunity_id','created_at','updated_at','payload'] : ['transfer_id','tenant_id','call_id','status','updated_at','payload'];
    const values = chat ? [key,owner,data.opportunityId || null,iso(data.createdAt),iso(data.updatedAt),JSON.stringify(data)] : [key,owner,data.callId || null,data.status || null,iso(data.updatedAt),JSON.stringify(data)];
    await client.query(`INSERT INTO bookedradar.${table} (${columns.join(',')}) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (${pk}) DO UPDATE SET ${columns.slice(1).map(c=>`${c}=EXCLUDED.${c}`).join(',')}`, values);
    await client.query('COMMIT'); return data;
  } catch (error) { try { await client.query('ROLLBACK'); } catch {} throw error; }
  finally { client.release(); }
}

export class PostgresWebChatStore {
  constructor(pool, tenantId) { this.pool=pool; this.tenantId=tenant(tenantId); }
  async getOrCreate(sessionId = '') {
    if (sessionId) {
      const { rows } = await this.pool.query('SELECT payload FROM bookedradar.web_chat_sessions WHERE session_id=$1 AND tenant_id=$2', [sessionId,this.tenantId]);
      if (rows.length) return rows[0].payload;
    }
    const id = crypto.randomUUID();
    return mutate(this.pool,'web_chat_sessions','session_id',id,this.tenantId,true,() => ({ id,tenantId:this.tenantId,createdAt:Date.now(),updatedAt:Date.now(),messages:[],fields:{},opportunityId:null,revision:0 }));
  }
  update(sessionId, patch, { expectedRevision } = {}) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || ['id','tenantId','createdAt','revision'].some(k=>k in patch)) throw new Error('chat_patch_invalid');
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('chat_revision_required');
    return mutate(this.pool,'web_chat_sessions','session_id',sessionId,this.tenantId,false,prior => {
      if ((prior.revision || 0) !== expectedRevision) throw new Error('stale_chat_revision');
      if (patch.messages !== undefined && !Array.isArray(patch.messages)) throw new Error('chat_messages_invalid');
      return { ...prior,...patch,...(patch.messages ? { messages:patch.messages.slice(-24) } : {}),updatedAt:Date.now(),revision:expectedRevision+1 };
    });
  }
}

export class PostgresTransferStore {
  constructor(pool, tenantId) { this.pool=pool; this.tenantId=tenant(tenantId); }
  async getCall(id) {
    const { rows } = await this.pool.query('SELECT payload FROM bookedradar.transfer_records WHERE transfer_id=$1 AND tenant_id=$2', [id,this.tenantId]);
    return rows[0]?.payload || null;
  }
  patchCall(id, patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || (patch.tenantId !== undefined && patch.tenantId !== this.tenantId)) throw new Error('transfer_patch_invalid');
    return mutate(this.pool,'transfer_records','transfer_id',id,this.tenantId,true,prior=>({ ...(prior || {}),...patch,tenantId:this.tenantId,updatedAt:Date.now() }));
  }
}

export class PostgresGrowthMetricsStore {
  constructor(pool) { this.pool=pool; }
  async record(input) {
    const normalized = normalizeGrowthEvent(input);
    if (!normalized.ok) throw new Error(normalized.error);
    const e=normalized.event;
    const key=[e.event,e.trade,e.source,e.variant].join('|');
    const { rows } = await this.pool.query(`INSERT INTO bookedradar.growth_metrics AS existing (metric_key,metric_count,updated_at,payload)
      VALUES ($1,1,clock_timestamp(),jsonb_build_object('key',$1::text,'count',1))
      ON CONFLICT (metric_key) DO UPDATE SET metric_count=existing.metric_count+1,updated_at=clock_timestamp(),payload=jsonb_build_object('key',$1::text,'count',existing.metric_count+1)
      RETURNING metric_count::text AS count`, [key]);
    return rows[0].count;
  }
  async summary() {
    const { rows } = await this.pool.query('SELECT metric_key,metric_count::text AS count,updated_at FROM bookedradar.growth_metrics ORDER BY metric_key');
    const counts=Object.create(null); let updatedAt=null;
    for (const row of rows) {
      const value=Number(row.count); if (!Number.isSafeInteger(value)) throw new Error('metric_precision_limit');
      counts[row.metric_key]=value;
      const at=row.updated_at ? new Date(row.updated_at).toISOString() : null;
      if (at && (!updatedAt || at>updatedAt)) updatedAt=at;
    }
    return { counts,updatedAt };
  }
}
