import fs from 'node:fs/promises';
import path from 'node:path';
import { CallHistoryStore } from './call-history.js';

// Reuse the tested business rules without reading/writing a file or keeping a
// process-wide cache. Every mutation gets a fresh view under a database row lock.
function view(calls = Object.create(null)) {
  const store = new CallHistoryStore('/unused/postgres-call-history.json');
  store.loaded = true;
  store.data = { calls };
  store.persist = async () => {};
  return store;
}
function id(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('call_id_required');
  return value;
}
function date(value) { return value ? new Date(Number(value)).toISOString() : null; }

export class PostgresCallHistoryStore {
  constructor(pool, tenantId) {
    if (typeof tenantId !== 'string' || !tenantId.trim() || tenantId.length > 120 || tenantId.trim() !== tenantId) throw new Error('tenant_id_required');
    this.pool = pool;
    this.tenantId = tenantId;
  }

  async #mutate(callId, method, args) {
    id(callId);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='5s'");
      await client.query("SET LOCAL statement_timeout='15s'");
      if (method === 'start') {
        const fresh = view();
        await fresh.start(callId, args);
        await client.query(`INSERT INTO bookedradar.voice_calls (call_id,tenant_id,started_at,updated_at,payload)
          VALUES ($1,$2,$3,$3,$4::jsonb) ON CONFLICT (call_id) DO NOTHING`,
          [callId, this.tenantId, date(fresh.data.calls[callId].startedAt), JSON.stringify(fresh.data.calls[callId])]);
      }
      const { rows } = await client.query('SELECT payload FROM bookedradar.voice_calls WHERE call_id=$1 AND tenant_id=$2 FOR UPDATE', [callId, this.tenantId]);
      if (!rows.length) {
        if (method === 'start') throw new Error('call_tenant_conflict');
        await client.query('COMMIT');
        return null;
      }
      const store = view({ [callId]: rows[0].payload });
      const result = method === 'mark'
        ? await store.mark(callId, args.event, args.fields)
        : await store[method](callId, args);
      const call = store.data.calls[callId];
      if (call.callId !== callId || call.tenantId !== this.tenantId) throw new Error('call_tenant_conflict');
      await client.query(`UPDATE bookedradar.voice_calls SET caller_masked=$3,dialed_masked=$4,
        started_at=$5,ended_at=$6,updated_at=$7,transferred=$8,spam_ended=$9,payload=$10::jsonb
        WHERE call_id=$1 AND tenant_id=$2`,
        [callId, this.tenantId, call.callerMasked || null, call.dialedMasked || null,
          date(call.startedAt), date(call.endedAt), date(call.updatedAt), Boolean(call.transferred), Boolean(call.spamEnded), JSON.stringify(call)]);
      if (method === 'addTurn') {
        // Keep normalized turns and the bounded transcript payload in one commit.
        await client.query('DELETE FROM bookedradar.call_turns WHERE call_id=$1', [callId]);
        for (const [sequence, turn] of (call.transcript || []).entries()) {
          await client.query(`INSERT INTO bookedradar.call_turns
            (call_id,sequence_no,speaker,item_id,occurred_at,text_content) VALUES ($1,$2,$3,$4,$5,$6)`,
            [callId, sequence, turn.speaker, turn.itemId || null, turn.at || null, turn.text]);
        }
      }
      await client.query('COMMIT');
      return structuredClone(result);
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally { client.release(); }
  }

  start(callId, args = {}) {
    if (args.tenantId !== undefined && args.tenantId !== this.tenantId) throw new Error('call_tenant_conflict');
    return this.#mutate(callId, 'start', { ...args, tenantId: this.tenantId });
  }
  addTurn(callId, args = {}) { return this.#mutate(callId, 'addTurn', args); }
  addKnowledgeGap(callId, args = {}) { return this.#mutate(callId, 'addKnowledgeGap', args); }
  mark(callId, event, fields = {}) { return this.#mutate(callId, 'mark', { event, fields }); }
  finish(callId, patch = {}) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('call_patch_invalid');
    if (['callId', 'tenantId', 'transcript', 'startedAt', 'milestones', 'knowledgeGaps'].some(key => key in patch)) throw new Error('call_structural_patch_forbidden');
    return this.#mutate(callId, 'finish', patch);
  }

  async get(callId) {
    id(callId);
    const { rows } = await this.pool.query('SELECT payload FROM bookedradar.voice_calls WHERE call_id=$1 AND tenant_id=$2', [callId, this.tenantId]);
    return rows[0]?.payload || null;
  }
  async readView() {
    const { rows } = await this.pool.query('SELECT call_id,payload FROM bookedradar.voice_calls WHERE tenant_id=$1', [this.tenantId]);
    return view(Object.fromEntries(rows.map(row => [row.call_id, row.payload])));
  }
  async list(options = {}) { return (await this.readView()).list(this.tenantId, options); }
  async stats() { return (await this.readView()).stats(this.tenantId); }
  async statsSince(sinceMs = 0) { return (await this.readView()).statsSince(this.tenantId, sinceMs); }
  async operationalSummary({ sinceMs = 0, now = Date.now() } = {}) {
    return (await this.readView()).operationalSummary({ tenantId: this.tenantId, sinceMs, now });
  }
}

export async function exportPostgresCallHistory(pool, root, { writersQuiesced = false } = {}) {
  if (!writersQuiesced) throw new Error('writers_must_be_quiesced');
  if (typeof root !== 'string' || !root.trim()) throw new Error('destination_root_required');
  const { rows } = await pool.query('SELECT call_id,payload FROM bookedradar.voice_calls ORDER BY call_id');
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const directory = await fs.mkdtemp(path.join(root, 'history-export-'));
  await fs.chmod(directory, 0o700);
  const file = path.join(directory, 'call-history.json');
  await fs.writeFile(file, JSON.stringify({ calls: Object.fromEntries(rows.map(row => [row.call_id, row.payload])) }) + '\n', { flag: 'wx', mode: 0o600 });
  return { file, calls: rows.length };
}
