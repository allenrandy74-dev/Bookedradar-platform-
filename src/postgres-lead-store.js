import fs from 'node:fs/promises';
import path from 'node:path';
import { stableHash } from './postgres-migration-audit.js';

export class PostgresLeadStore {
  constructor(pool, tenantId) {
    if (typeof tenantId !== 'string' || !tenantId.trim()) throw new Error('tenant_id_required');
    this.pool = pool;
    this.tenantId = tenantId;
  }

  async append(lead) {
    if (!lead || typeof lead !== 'object' || Array.isArray(lead)) throw new Error('lead_required');
    const payload = JSON.parse(JSON.stringify(lead));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('lead_required');
    const owner = payload.tenant_id || payload.tenantId;
    if (owner !== this.tenantId ||
        (payload.tenant_id !== undefined && payload.tenant_id !== this.tenantId) ||
        (payload.tenantId !== undefined && payload.tenantId !== this.tenantId)) throw new Error('lead_tenant_conflict');
    // Exactly matches the shadow import key. Identical payload replay is a no-op;
    // a changed capture is retained as another record, never overwriting history.
    const sourceKey = stableHash(payload);
    const result = await this.pool.query(`
      INSERT INTO bookedradar.lead_captures (source_key,tenant_id,call_id,captured_at,payload)
      VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (source_key) DO NOTHING
      RETURNING lead_id::text AS id`,
      [sourceKey, this.tenantId, payload.call_id || payload.callId || null,
        payload.captured_at || payload.capturedAt || payload.timestamp || null, JSON.stringify(payload)]);
    if (result.rows.length) return { sourceKey, id: result.rows[0].id, duplicate: false };
    const existing = await this.pool.query(
      'SELECT lead_id::text AS id FROM bookedradar.lead_captures WHERE source_key=$1 AND tenant_id=$2',
      [sourceKey, this.tenantId]
    );
    if (!existing.rows.length) throw new Error('lead_conflict');
    return { sourceKey, id: existing.rows[0].id, duplicate: true };
  }

  async get(sourceKey) {
    if (typeof sourceKey !== 'string' || !/^[a-f0-9]{64}$/.test(sourceKey)) throw new Error('lead_key_invalid');
    const { rows } = await this.pool.query(
      'SELECT payload FROM bookedradar.lead_captures WHERE source_key=$1 AND tenant_id=$2', [sourceKey, this.tenantId]
    );
    return rows[0]?.payload || null;
  }

  async list({ afterId = '0', limit = 100 } = {}) {
    if (typeof afterId !== 'string' || !/^\d{1,19}$/.test(afterId) || BigInt(afterId) > 9223372036854775807n) throw new Error('lead_cursor_invalid');
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('lead_limit_invalid');
    const { rows } = await this.pool.query(`
      SELECT lead_id::text AS id, source_key AS "sourceKey", payload
      FROM bookedradar.lead_captures WHERE tenant_id=$1 AND lead_id>$2::bigint
      ORDER BY lead_id LIMIT $3`, [this.tenantId, afterId, limit]);
    return rows;
  }
}

// Operator-only all-tenant export. Must be combined with other store exports
// under a shared writer freeze before any future full-platform rollback.
export async function exportPostgresLeads(pool, destinationRoot, { writersQuiesced = false } = {}) {
  if (!writersQuiesced) throw new Error('writers_must_be_quiesced');
  if (typeof destinationRoot !== 'string' || !destinationRoot.trim()) throw new Error('destination_root_required');
  const { rows } = await pool.query('SELECT payload FROM bookedradar.lead_captures ORDER BY lead_id');
  await fs.mkdir(destinationRoot, { recursive: true, mode: 0o700 });
  const directory = await fs.mkdtemp(path.join(destinationRoot, 'leads-export-'));
  await fs.chmod(directory, 0o700);
  const file = path.join(directory, 'leads.jsonl');
  await fs.writeFile(file, rows.map(row => JSON.stringify(row.payload) + '\n').join(''), { flag: 'wx', mode: 0o600 });
  return { file, leads: rows.length };
}
