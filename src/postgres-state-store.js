// Deliberately not selected by server.js until all stores and cutover gates pass.
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

function required(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name}_required`);
  return value;
}

export class PostgresCallStateStore {
  constructor(pool, tenantId) {
    this.pool = pool;
    this.tenantId = required(tenantId, "tenant_id");
  }

  async getCall(callId) {
    required(callId, "call_id");
    const result = await this.pool.query(
      "SELECT payload FROM bookedradar.call_control_state WHERE call_id=$1 AND tenant_id=$2",
      [callId, this.tenantId]
    );
    return result.rows[0]?.payload || null;
  }

  async patchCall(callId, patch) {
    required(callId, "call_id");
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("call_patch_required");
    if (patch.tenantId !== undefined && patch.tenantId !== this.tenantId) throw new Error("call_tenant_conflict");
    const payload = JSON.stringify({ ...patch, tenantId: this.tenantId });
    // Merge inside the statement, under PostgreSQL's row lock. No cached read/modify/write.
    // The WHERE clause prevents a globally unique call ID being reassigned to another tenant.
    const result = await this.pool.query(`
      INSERT INTO bookedradar.call_control_state AS existing (call_id, tenant_id, updated_at, payload)
      VALUES ($1,$2,clock_timestamp(),$3::jsonb || jsonb_build_object('updatedAt',floor(extract(epoch FROM clock_timestamp())*1000)::bigint))
      ON CONFLICT (call_id) DO UPDATE SET
        updated_at=clock_timestamp(),
        payload=existing.payload || $3::jsonb || jsonb_build_object('updatedAt',floor(extract(epoch FROM clock_timestamp())*1000)::bigint)
      WHERE existing.tenant_id=$2
      RETURNING payload`, [callId, this.tenantId, payload]);
    if (!result.rows.length) throw new Error("call_tenant_conflict");
    return result.rows[0].payload;
  }
}

// Permanent side-effect intents. Never use expiring webhook receipts for these.
const ATTEMPT_IDENTITY = ['tenantId', 'callId', 'target', 'kind', 'fingerprint'];
function attemptIdentity(intent) {
  if (!intent || typeof intent !== 'object' || Array.isArray(intent)) throw new Error('attempt_intent_required');
  return Object.fromEntries(ATTEMPT_IDENTITY.map(key => [key, required(intent[key], `attempt_${key}`)]));
}
export class PostgresAttemptStore {
  constructor(pool) { this.pool = pool; }
  async claimAttempt(key, intent) {
    required(key, 'attempt_key');
    const identity = attemptIdentity(intent);
    const record = { ...intent, identity, key, claimToken: randomUUID(), status: 'pending', createdAt: new Date().toISOString() };
    // ON CONFLICT obtains the row lock and returns the existing durable intent.
    // It deliberately does not reclaim pending/unknown records after any age.
    const result = await this.pool.query(`
      INSERT INTO bookedradar.provider_attempt_receipts AS existing (attempt_key, payload)
      VALUES ($1,$2::jsonb)
      ON CONFLICT (attempt_key) DO UPDATE SET payload=existing.payload
      RETURNING payload`, [key, JSON.stringify(record)]);
    const stored = result.rows[0]?.payload;
    if (!stored) throw new Error('attempt_claim_not_persisted');
    if (ATTEMPT_IDENTITY.some(field => stored.identity?.[field] !== identity[field])) throw new Error('attempt_intent_conflict');
    return { claimed: stored.claimToken === record.claimToken, record: stored };
  }
  async finishAttempt(key, patch) {
    required(key, 'attempt_key');
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('attempt_patch_required');
    required(patch.claimToken, 'attempt_claimToken');
    const identity = attemptIdentity(patch);
    if (!['pending','accepted','uncertain','completed','failed','reconciliation_required'].includes(patch.status)) throw new Error('attempt_status_invalid');
    if (Object.hasOwn(patch, 'identity')) throw new Error('immutable_attempt_identity');
    for (const field of ['key','createdAt']) if (Object.hasOwn(patch, field)) throw new Error(`immutable_${field}`);
    const allowed = ['status', 'phase', 'targetUri', 'result', 'providerId', 'acceptance'];
    const changes = Object.fromEntries(allowed.filter(field => Object.hasOwn(patch, field)).map(field => [field, patch[field]]));
    const bindings = { identity };
    const result = await this.pool.query(`
      UPDATE bookedradar.provider_attempt_receipts
      SET payload=payload || $3::jsonb || jsonb_build_object('updatedAt',$5::text)
      WHERE attempt_key=$1 AND payload->>'claimToken'=$2 AND payload->>'status'='pending'
        AND payload @> $4::jsonb
      RETURNING payload`, [key, patch.claimToken, JSON.stringify(changes), JSON.stringify(bindings), new Date().toISOString()]);
    if (!result.rows.length) throw new Error('attempt_claim_conflict');
    return result.rows[0].payload;
  }
}

// Webhook IDs are globally unique provider event IDs, matching the existing JSON contract.
// Failures propagate; never silently switch to JSON and split the deduplication authority.
export class PostgresWebhookStore {
  constructor(pool) { this.pool = pool; }

  async hasInquiryReceipt(id) {
    required(id, "webhook_id");
    const result = await this.pool.query(
      "SELECT 1 FROM bookedradar.webhook_receipts WHERE webhook_id=$1 AND received_at >= clock_timestamp() - interval '24 hours'", [id]
    );
    return result.rows.length > 0;
  }

  async markInquiryOnce(id) {
    required(id, "inquiry_key");
    return this.markWebhookOnce(id);
  }

  async markWebhookOnce(id) {
    if (!id) return true;
    required(id, "webhook_id");
    const result = await this.pool.query(`
      INSERT INTO bookedradar.webhook_receipts AS existing (webhook_id, received_at)
      VALUES ($1,clock_timestamp())
      ON CONFLICT (webhook_id) DO UPDATE SET received_at=clock_timestamp()
      WHERE existing.received_at < clock_timestamp() - interval '24 hours'
      RETURNING webhook_id`, [id]);
    return result.rows.length === 1;
  }

  async releaseWebhook(id) {
    if (!id) return false;
    required(id, "webhook_id");
    const result = await this.pool.query(
      "DELETE FROM bookedradar.webhook_receipts WHERE webhook_id=$1 RETURNING webhook_id", [id]
    );
    return result.rows.length === 1;
  }
}

// Operator-only export of call state, webhook receipts and permanent attempts. This is NOT a full-platform rollback.
// Caller must stop/drain all writers before using the export for a future cutover.
// Export creates a new private directory and never overwrites a live JSON file.
export async function exportPostgresCallState(pool, destinationRoot, { writersQuiesced = false } = {}) {
  if (!writersQuiesced) throw new Error("writers_must_be_quiesced");
  required(destinationRoot, "destination_root");
  const client = await pool.connect();
  const state = { processedWebhooks: Object.create(null), calls: Object.create(null), attempts: Object.create(null) };
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const receipts = await client.query("SELECT webhook_id, received_at FROM bookedradar.webhook_receipts ORDER BY webhook_id");
    const calls = await client.query("SELECT call_id, payload FROM bookedradar.call_control_state ORDER BY call_id");
    const attempts = await client.query("SELECT attempt_key, payload FROM bookedradar.provider_attempt_receipts ORDER BY attempt_key");
    for (const row of attempts.rows) state.attempts[row.attempt_key] = row.payload;
    for (const row of receipts.rows) state.processedWebhooks[row.webhook_id] = new Date(row.received_at).getTime();
    for (const row of calls.rows) state.calls[row.call_id] = row.payload;
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
  await fs.mkdir(destinationRoot, { recursive: true, mode: 0o700 });
  const directory = await fs.mkdtemp(path.join(destinationRoot, "call-state-export-"));
  await fs.chmod(directory, 0o700);
  const file = path.join(directory, "state.json");
  await fs.writeFile(file, JSON.stringify(state, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return { file, calls: Object.keys(state.calls).length, webhooks: Object.keys(state.processedWebhooks).length, attempts: Object.keys(state.attempts).length };
}

