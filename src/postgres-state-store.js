// Deliberately not selected by server.js until all stores and cutover gates pass.
import fs from "node:fs/promises";
import path from "node:path";

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

  async claimBooking(callId, { attemptId, requestHash }) {
    required(callId, "call_id");
    required(attemptId, "booking_attempt_id");
    if (!/^[a-f0-9]{64}$/.test(requestHash || "")) throw new Error("booking_request_hash_required");
    const attempt = JSON.stringify({ attemptId, requestHash, status: "pending" });
    // One booking attempt per call. Never expire/reclaim an uncertain write.
    const { rows } = await this.pool.query(`
      UPDATE bookedradar.call_control_state SET updated_at=clock_timestamp(),
        payload=payload || jsonb_build_object('bookingAttempt',$3::jsonb)
      WHERE call_id=$1 AND tenant_id=$2 AND NOT (payload ? 'bookingAttempt')
      RETURNING payload->'bookingAttempt' AS attempt`, [callId, this.tenantId, attempt]);
    return rows[0]?.attempt || null;
  }

  async finishBooking(callId, attemptId, { status, result }) {
    required(callId, "call_id");
    required(attemptId, "booking_attempt_id");
    if (!["confirmed", "unconfirmed", "uncertain"].includes(status)) throw new Error("booking_status_invalid");
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("booking_result_required");
    if (status === "confirmed" && (result.confirmed !== true || typeof result.bookingId !== "string" || !result.bookingId.trim())) {
      throw new Error("booking_receipt_required");
    }
    const patch = JSON.stringify({ status, result });
    const { rows } = await this.pool.query(`
      UPDATE bookedradar.call_control_state SET updated_at=clock_timestamp(),
        payload=payload || jsonb_build_object('bookingAttempt',(payload->'bookingAttempt') || $4::jsonb)
      WHERE call_id=$1 AND tenant_id=$2 AND payload->'bookingAttempt'->>'attemptId'=$3
        AND payload->'bookingAttempt'->>'status'='pending'
      RETURNING payload->'bookingAttempt' AS attempt`, [callId, this.tenantId, attemptId, patch]);
    return rows[0]?.attempt || null;
  }
}

// Webhook IDs are globally unique provider event IDs, matching the existing JSON contract.
// Failures propagate; never silently switch to JSON and split the deduplication authority.
export class PostgresWebhookStore {
  constructor(pool) { this.pool = pool; }

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

// Operator-only export of these two tables. This is NOT a full-platform rollback.
// Caller must stop/drain all writers before using the export for a future cutover.
// Export creates a new private directory and never overwrites a live JSON file.
export async function exportPostgresCallState(pool, destinationRoot, { writersQuiesced = false } = {}) {
  if (!writersQuiesced) throw new Error("writers_must_be_quiesced");
  required(destinationRoot, "destination_root");
  const client = await pool.connect();
  const state = { processedWebhooks: Object.create(null), calls: Object.create(null) };
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const receipts = await client.query("SELECT webhook_id, received_at FROM bookedradar.webhook_receipts ORDER BY webhook_id");
    const calls = await client.query("SELECT call_id, payload FROM bookedradar.call_control_state ORDER BY call_id");
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
  return { file, calls: Object.keys(state.calls).length, webhooks: Object.keys(state.processedWebhooks).length };
}
