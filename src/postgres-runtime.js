import { Pool } from "pg";

const POSTGRES_URL_RE = /^postgres(?:ql)?:\/\//i;

export function createPostgresPool({
  connectionString,
  max = 5,
  idleTimeoutMillis = 30_000,
  connectionTimeoutMillis = 8_000,
} = {}) {
  if (!POSTGRES_URL_RE.test(String(connectionString || ""))) {
    throw new Error("postgres_connection_string_required");
  }
  return new Pool({
    connectionString,
    max: Math.min(Math.max(Number(max) || 5, 1), 20),
    idleTimeoutMillis: Math.max(Number(idleTimeoutMillis) || 30_000, 1_000),
    connectionTimeoutMillis: Math.max(Number(connectionTimeoutMillis) || 8_000, 1_000),
    application_name: "bookedradar-platform",
  });
}

export async function postgresHealth(pool) {
  const startedAt = Date.now();
  const result = await pool.query(
    "SELECT current_database() AS database_name, current_setting('server_version') AS server_version"
  );
  return {
    ok: true,
    latencyMs: Date.now() - startedAt,
    databaseName: result.rows?.[0]?.database_name || null,
    serverVersion: result.rows?.[0]?.server_version || null,
  };
}

export async function applyPostgresSchema(pool, schemaSql) {
  if (!String(schemaSql || "").trim()) throw new Error("postgres_schema_required");
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('bookedradar_schema_migration'))");
    await client.query(String(schemaSql));
    const verify = await client.query(
      "SELECT to_regclass('bookedradar.voice_calls') AS voice_calls, to_regclass('bookedradar.recovery_opportunities') AS opportunities"
    );
    if (!verify.rows?.[0]?.voice_calls || !verify.rows?.[0]?.opportunities) {
      throw new Error("postgres_schema_verification_failed");
    }
    return { ok: true };
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock(hashtext('bookedradar_schema_migration'))");
    } catch {}
    client.release();
  }
}

async function upsert(client, sql, values) {
  await client.query(sql, values);
}

export async function importMigrationManifest(pool, manifest, {
  migrationId = `migration_${Date.now()}`,
} = {}) {
  if (!manifest?.rows || !manifest?.snapshotFingerprint) {
    throw new Error("postgres_migration_manifest_required");
  }

  const client = await pool.connect();
  const counts = {};
  try {
    await client.query("BEGIN");

    await upsert(client,
      `INSERT INTO bookedradar.migration_runs
        (migration_id, source_snapshot_sha256, started_at, status, counts, validation)
       VALUES ($1,$2,now(),'running',$3::jsonb,$4::jsonb)
       ON CONFLICT (migration_id) DO NOTHING`,
      [migrationId, manifest.snapshotFingerprint, JSON.stringify(manifest.counts || {}), JSON.stringify({})]
    );

    for (const row of manifest.rows.webhookReceipts || []) {
      await upsert(client,
        `INSERT INTO bookedradar.webhook_receipts (webhook_id, received_at)
         VALUES ($1,$2)
         ON CONFLICT (webhook_id) DO UPDATE SET received_at=EXCLUDED.received_at`,
        [row.webhookId, row.receivedAt]
      );
    }
    counts.webhookReceipts = (manifest.rows.webhookReceipts || []).length;

    for (const row of manifest.rows.callControlState || []) {
      await upsert(client,
        `INSERT INTO bookedradar.call_control_state (call_id, tenant_id, updated_at, payload)
         VALUES ($1,$2,$3,$4::jsonb)
         ON CONFLICT (call_id) DO UPDATE SET
           tenant_id=EXCLUDED.tenant_id, updated_at=EXCLUDED.updated_at, payload=EXCLUDED.payload`,
        [row.callId, row.tenantId, row.updatedAt || new Date().toISOString(), JSON.stringify(row.payload || {})]
      );
    }
    counts.callControlState = (manifest.rows.callControlState || []).length;

    for (const row of manifest.rows.voiceCalls || []) {
      await upsert(client,
        `INSERT INTO bookedradar.voice_calls
          (call_id, tenant_id, caller_masked, dialed_masked, started_at, ended_at, updated_at, transferred, spam_ended, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
         ON CONFLICT (call_id) DO UPDATE SET
          tenant_id=EXCLUDED.tenant_id, caller_masked=EXCLUDED.caller_masked,
          dialed_masked=EXCLUDED.dialed_masked, started_at=EXCLUDED.started_at,
          ended_at=EXCLUDED.ended_at, updated_at=EXCLUDED.updated_at,
          transferred=EXCLUDED.transferred, spam_ended=EXCLUDED.spam_ended, payload=EXCLUDED.payload`,
        [
          row.callId, row.tenantId, row.callerMasked || null, row.dialedMasked || null,
          row.startedAt, row.endedAt, row.updatedAt || new Date().toISOString(),
          Boolean(row.transferred), Boolean(row.spamEnded), JSON.stringify(row.payload || {}),
        ]
      );
    }
    counts.voiceCalls = (manifest.rows.voiceCalls || []).length;

    for (const row of manifest.rows.callTurns || []) {
      await upsert(client,
        `INSERT INTO bookedradar.call_turns
          (call_id, sequence_no, speaker, item_id, occurred_at, text_content)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (call_id, sequence_no) DO UPDATE SET
          speaker=EXCLUDED.speaker, item_id=EXCLUDED.item_id,
          occurred_at=EXCLUDED.occurred_at, text_content=EXCLUDED.text_content`,
        [row.callId, row.sequenceNo, row.speaker, row.itemId, row.occurredAt, row.textContent]
      );
    }
    counts.callTurns = (manifest.rows.callTurns || []).length;

    for (const row of manifest.rows.leads || []) {
      await upsert(client,
        `INSERT INTO bookedradar.lead_captures
          (source_key, tenant_id, call_id, captured_at, payload)
         VALUES ($1,$2,$3,$4,$5::jsonb)
         ON CONFLICT (source_key) DO UPDATE SET
          tenant_id=EXCLUDED.tenant_id, call_id=EXCLUDED.call_id,
          captured_at=EXCLUDED.captured_at, payload=EXCLUDED.payload`,
        [row.sourceKey, row.tenantId, row.callId, row.capturedAt, JSON.stringify(row.payload || {})]
      );
    }
    counts.leads = (manifest.rows.leads || []).length;

    for (const row of manifest.rows.contacts || []) {
      await upsert(client,
        `INSERT INTO bookedradar.recovery_contacts
          (contact_key, tenant_id, updated_at, payload)
         VALUES ($1,$2,$3,$4::jsonb)
         ON CONFLICT (contact_key) DO UPDATE SET
          tenant_id=EXCLUDED.tenant_id, updated_at=EXCLUDED.updated_at, payload=EXCLUDED.payload`,
        [row.contactKey, row.tenantId, row.updatedAt, JSON.stringify(row.payload || {})]
      );
    }
    counts.contacts = (manifest.rows.contacts || []).length;

    for (const row of manifest.rows.opportunities || []) {
      await upsert(client,
        `INSERT INTO bookedradar.recovery_opportunities
          (opportunity_id, tenant_id, contact_key, status, created_at, updated_at, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
         ON CONFLICT (opportunity_id) DO UPDATE SET
          tenant_id=EXCLUDED.tenant_id, contact_key=EXCLUDED.contact_key, status=EXCLUDED.status,
          created_at=EXCLUDED.created_at, updated_at=EXCLUDED.updated_at, payload=EXCLUDED.payload`,
        [row.opportunityId, row.tenantId, row.contactKey, row.status, row.createdAt, row.updatedAt, JSON.stringify(row.payload || {})]
      );
    }
    counts.opportunities = (manifest.rows.opportunities || []).length;

    for (const row of manifest.rows.recoveryEvents || []) {
      await upsert(client,
        `INSERT INTO bookedradar.recovery_events
          (event_id, tenant_id, idempotency_key, opportunity_id, contact_key, occurred_at, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
         ON CONFLICT (event_id) DO UPDATE SET
          tenant_id=EXCLUDED.tenant_id, idempotency_key=EXCLUDED.idempotency_key,
          opportunity_id=EXCLUDED.opportunity_id, contact_key=EXCLUDED.contact_key,
          occurred_at=EXCLUDED.occurred_at, payload=EXCLUDED.payload`,
        [row.eventId, row.tenantId, row.idempotencyKey, row.opportunityId, row.contactKey, row.occurredAt, JSON.stringify(row.payload || {})]
      );
    }
    counts.recoveryEvents = (manifest.rows.recoveryEvents || []).length;

    for (const row of manifest.rows.recoveryActions || []) {
      await upsert(client,
        `INSERT INTO bookedradar.recovery_actions
          (action_id, tenant_id, opportunity_id, contact_key, channel, status, due_at,
           claimed_by, claimed_at, claim_expires_at, created_at, completed_at, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
         ON CONFLICT (action_id) DO UPDATE SET
          tenant_id=EXCLUDED.tenant_id, opportunity_id=EXCLUDED.opportunity_id,
          contact_key=EXCLUDED.contact_key, channel=EXCLUDED.channel, status=EXCLUDED.status,
          due_at=EXCLUDED.due_at, claimed_by=EXCLUDED.claimed_by, claimed_at=EXCLUDED.claimed_at,
          claim_expires_at=EXCLUDED.claim_expires_at, created_at=EXCLUDED.created_at,
          completed_at=EXCLUDED.completed_at, payload=EXCLUDED.payload`,
        [
          row.actionId,row.tenantId,row.opportunityId,row.contactKey,row.channel,row.status,row.dueAt,
          row.claimedBy,row.claimedAt,row.claimExpiresAt,row.createdAt,row.completedAt,
          JSON.stringify(row.payload || {}),
        ]
      );
    }
    counts.recoveryActions = (manifest.rows.recoveryActions || []).length;

    for (const row of manifest.rows.attribution || []) {
      await upsert(client,
        `INSERT INTO bookedradar.recovery_attribution
          (opportunity_id, tenant_id, updated_at, payload)
         VALUES ($1,$2,$3,$4::jsonb)
         ON CONFLICT (opportunity_id) DO UPDATE SET
          tenant_id=EXCLUDED.tenant_id, updated_at=EXCLUDED.updated_at, payload=EXCLUDED.payload`,
        [row.opportunityId,row.tenantId,row.updatedAt,JSON.stringify(row.payload || {})]
      );
    }
    counts.attribution = (manifest.rows.attribution || []).length;

    for (const row of manifest.rows.webChatSessions || []) {
      await upsert(client,
        `INSERT INTO bookedradar.web_chat_sessions
          (session_id, tenant_id, opportunity_id, created_at, updated_at, payload)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb)
         ON CONFLICT (session_id) DO UPDATE SET
          tenant_id=EXCLUDED.tenant_id, opportunity_id=EXCLUDED.opportunity_id,
          created_at=EXCLUDED.created_at, updated_at=EXCLUDED.updated_at, payload=EXCLUDED.payload`,
        [row.sessionId,row.tenantId,row.opportunityId,row.createdAt,row.updatedAt,JSON.stringify(row.payload || {})]
      );
    }
    counts.webChatSessions = (manifest.rows.webChatSessions || []).length;

    for (const row of manifest.rows.transferRecords || []) {
      await upsert(client,
        `INSERT INTO bookedradar.transfer_records
          (transfer_id, tenant_id, call_id, status, updated_at, payload)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb)
         ON CONFLICT (transfer_id) DO UPDATE SET
          tenant_id=EXCLUDED.tenant_id, call_id=EXCLUDED.call_id,
          status=EXCLUDED.status, updated_at=EXCLUDED.updated_at, payload=EXCLUDED.payload`,
        [row.transferId,row.tenantId,row.callId,row.status,row.updatedAt,JSON.stringify(row.payload || {})]
      );
    }
    counts.transferRecords = (manifest.rows.transferRecords || []).length;

    for (const row of manifest.rows.growthMetrics || []) {
      await upsert(client,
        `INSERT INTO bookedradar.growth_metrics
          (metric_key, metric_count, updated_at, payload)
         VALUES ($1,$2,$3,$4::jsonb)
         ON CONFLICT (metric_key) DO UPDATE SET
          metric_count=EXCLUDED.metric_count, updated_at=EXCLUDED.updated_at, payload=EXCLUDED.payload`,
        [row.metricKey,row.metricCount,row.updatedAt,JSON.stringify(row.payload || {})]
      );
    }
    counts.growthMetrics = (manifest.rows.growthMetrics || []).length;

    for (const row of manifest.rows.billingState || []) {
      await upsert(client,
        `INSERT INTO bookedradar.billing_state (mode, updated_at, payload)
         VALUES ($1,now(),$2::jsonb)
         ON CONFLICT (mode) DO UPDATE SET updated_at=now(), payload=EXCLUDED.payload`,
        [row.mode,JSON.stringify(row.payload || {})]
      );
    }
    counts.billingState = (manifest.rows.billingState || []).length;

    await client.query(
      `UPDATE bookedradar.migration_runs
       SET completed_at=now(), status='imported', counts=$2::jsonb
       WHERE migration_id=$1`,
      [migrationId, JSON.stringify(counts)]
    );

    await client.query("COMMIT");
    return { ok: true, migrationId, counts };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function reconcileMigration(pool, manifest) {
  const expected = {
    webhookReceipts: (manifest.rows.webhookReceipts || []).length,
    callControlState: (manifest.rows.callControlState || []).length,
    voiceCalls: (manifest.rows.voiceCalls || []).length,
    callTurns: (manifest.rows.callTurns || []).length,
    leads: (manifest.rows.leads || []).length,
    contacts: (manifest.rows.contacts || []).length,
    opportunities: (manifest.rows.opportunities || []).length,
    recoveryEvents: (manifest.rows.recoveryEvents || []).length,
    recoveryActions: (manifest.rows.recoveryActions || []).length,
    attribution: (manifest.rows.attribution || []).length,
    webChatSessions: (manifest.rows.webChatSessions || []).length,
    transferRecords: (manifest.rows.transferRecords || []).length,
    growthMetrics: (manifest.rows.growthMetrics || []).length,
    billingState: (manifest.rows.billingState || []).length,
  };

  const queries = {
    webhookReceipts: "SELECT count(*)::int AS count FROM bookedradar.webhook_receipts",
    callControlState: "SELECT count(*)::int AS count FROM bookedradar.call_control_state",
    voiceCalls: "SELECT count(*)::int AS count FROM bookedradar.voice_calls",
    callTurns: "SELECT count(*)::int AS count FROM bookedradar.call_turns",
    leads: "SELECT count(*)::int AS count FROM bookedradar.lead_captures",
    contacts: "SELECT count(*)::int AS count FROM bookedradar.recovery_contacts",
    opportunities: "SELECT count(*)::int AS count FROM bookedradar.recovery_opportunities",
    recoveryEvents: "SELECT count(*)::int AS count FROM bookedradar.recovery_events",
    recoveryActions: "SELECT count(*)::int AS count FROM bookedradar.recovery_actions",
    attribution: "SELECT count(*)::int AS count FROM bookedradar.recovery_attribution",
    webChatSessions: "SELECT count(*)::int AS count FROM bookedradar.web_chat_sessions",
    transferRecords: "SELECT count(*)::int AS count FROM bookedradar.transfer_records",
    growthMetrics: "SELECT count(*)::int AS count FROM bookedradar.growth_metrics",
    billingState: "SELECT count(*)::int AS count FROM bookedradar.billing_state",
  };

  const actual = {};
  for (const [key, sql] of Object.entries(queries)) {
    const result = await pool.query(sql);
    actual[key] = Number(result.rows?.[0]?.count || 0);
  }

  const mismatches = Object.keys(expected)
    .filter(key => actual[key] !== expected[key])
    .map(key => ({ key, expected: expected[key], actual: actual[key] }));

  return {
    ok: mismatches.length === 0,
    expected,
    actual,
    mismatches,
  };
}
