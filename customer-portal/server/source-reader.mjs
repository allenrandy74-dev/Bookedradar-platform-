// INACTIVE LIBRARY. No pool creation, runtime registration, environment reads,
// source writes, provider calls, or migration execution. See SOURCE_INGESTION.md.
import { createHash } from 'node:crypto';
import { projectRecoveryInquiry, SourceProjectionError } from './source-projection.mjs';
import { SourceVisibilityError } from './source-visibility.mjs';

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SOURCE_SCHEMA = /^bookedradar(?:_test_[a-f0-9]{12})?$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const MAX_LINEAGE = 100;
export class SourceIngestionError extends Error {
  constructor(code) { super(code); this.name = 'SourceIngestionError'; this.code = code; }
}
export const requireSource = (condition, code) => { if (!condition) throw new SourceIngestionError(code); };
const validId = value => typeof value === 'string' && ID.test(value);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const linkText = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && !CONTROL.test(value);

// Extract only fixed keys in Postgres, not a complete payload in application
// memory. Missing keys stay missing; wrong types become fixed JSON null
// sentinels so malformed fields cannot smuggle an unapproved subtree into memory.
function pickSql(expression, keys, nested = {}) {
  const typesFor = key => Object.hasOwn(nested, key) ? ['object']
    : key === 'synthetic' ? ['boolean'] : key === 'occurredAt' ? ['string', 'number'] : ['string'];
  const expectedType = key => `jsonb_typeof(v) IN (${typesFor(key).map(type => `'${type}'`).join(',')})`;
  const typeCases = keys.map(key => `WHEN '${key}' THEN ${expectedType(key)}`).join(' ');
  const cases = keys.map(key => Object.hasOwn(nested, key) ? `WHEN '${key}' THEN ${nested[key]}`
    : `WHEN '${key}' THEN CASE WHEN ${expectedType(key)} THEN v ELSE 'null'::jsonb END`).join(' ');
  const allowedKeys = keys.map(key => `'${key}'`).join(',');
  return `(CASE WHEN jsonb_typeof(${expression})='object' THEN
    CASE WHEN NOT EXISTS (SELECT 1 FROM jsonb_each(${expression}) AS kt(k,v)
      WHERE k IN (${allowedKeys}) AND NOT (CASE k ${typeCases} ELSE true END)) THEN
      COALESCE((SELECT jsonb_object_agg(k,CASE k ${cases} ELSE 'null'::jsonb END)
        FROM jsonb_each(${expression}) AS kv(k,v) WHERE k IN (${allowedKeys})), '{}'::jsonb)
      ELSE 'null'::jsonb END
    ELSE 'null'::jsonb END)`;
}
const metadataSql = pickSql("r.payload->'metadata'", ['synthetic']);
const embeddedContactSql = pickSql("r.payload->'contact'", ['tenantId', 'contactKey', 'externalId', 'phone', 'email']);
const common = ['tenantId', 'synthetic', 'metadata'];
const opportunitySql = pickSql('r.payload', [...common, 'id', 'contactKey', 'sourceEventId', 'type', 'source', 'serviceType'], { metadata: metadataSql });
const contactSql = pickSql('r.payload', [...common, 'contactKey', 'kind', 'name', 'firstName', 'lastName', 'email', 'phone'], { metadata: metadataSql });
const eventSql = pickSql('r.payload', [...common, 'id', 'opportunityId', 'contactKey', 'type', 'occurredAt', 'contact'], { metadata: metadataSql, contact: embeddedContactSql });
const lineageSql = pickSql('r.payload', [...common, 'id', 'opportunityId', 'contactKey'], { metadata: metadataSql });
const boundedPayload = expression => `CASE WHEN octet_length((${expression})::text)<=32768 THEN ${expression} ELSE NULL END AS payload`;

function payload(row, tenantId, { legacyOwner = false } = {}) {
  requireSource(row && row.tenant_id === tenantId, 'source_tenant_mismatch');
  requireSource(plain(row.payload), 'invalid_source_payload');
  const item = row.payload;
  if (Object.hasOwn(item, 'tenantId')) requireSource(item.tenantId === tenantId, 'source_tenant_mismatch');
  else requireSource(legacyOwner, 'source_tenant_mismatch');
  return legacyOwner && !Object.hasOwn(item, 'tenantId') ? { ...item, tenantId } : item;
}
function optionalColumn(column, value) {
  // SQL nullable index columns use NULL for an absent JSON property only.
  requireSource(column === (value === undefined ? null : value), 'source_column_link_mismatch');
}
function marker(item) {
  requireSource(item.metadata === undefined || plain(item.metadata), 'invalid_source_metadata');
  const markers = [item.synthetic, item.metadata?.synthetic];
  requireSource(markers.every(value => value === undefined || typeof value === 'boolean'), 'invalid_synthetic_marker');
  requireSource(!markers.includes(true), 'source_synthetic_excluded');
}
function lineageRow(row, tenantId, opportunityId, contactKey, kind) {
  const item = payload(row, tenantId, { legacyOwner: kind !== 'action' });
  requireSource(kind === 'attribution' ? item.opportunityId === row.id : item.id === row.id, 'source_column_id_mismatch');
  if (kind !== 'attribution') optionalColumn(row.opportunity_id, item.opportunityId);
  requireSource(item.opportunityId === opportunityId, 'source_lineage_link_mismatch');
  if (kind !== 'attribution') optionalColumn(row.contact_key, item.contactKey);
  if (item.contactKey !== undefined) {
    requireSource(linkText(item.contactKey), 'source_lineage_contact_mismatch');
    // The engine stores a raw event key as received, but namespaces contact and
    // action keys. Canonicalize only the event form before checking the binding.
    const linkedKey = kind === 'event' && !item.contactKey.startsWith(`${tenantId}:`)
      ? `${tenantId}:${item.contactKey}` : item.contactKey;
    requireSource(linkedKey === contactKey, 'source_lineage_contact_mismatch');
  }
  marker(item);
}

async function readTriple(db, schema, tenantId, opportunityId) {
  requireSource(validId(opportunityId), 'invalid_opportunity_id');
  const s = `"${schema}"`;
  const opportunities = await db.query(`SELECT r.tenant_id,r.opportunity_id AS id,r.contact_key,${boundedPayload(opportunitySql)}
    FROM ${s}.recovery_opportunities r WHERE r.tenant_id=$1 AND r.opportunity_id=$2 LIMIT 1`, [tenantId, opportunityId]);
  requireSource(opportunities.rows.length === 1, 'source_opportunity_missing');
  const opportunityRow = opportunities.rows[0];
  const opportunity = payload(opportunityRow, tenantId);
  requireSource(opportunity.id === opportunityId && opportunityRow.id === opportunityId, 'source_column_id_mismatch');
  requireSource(opportunityRow.contact_key === opportunity.contactKey && linkText(opportunity.contactKey), 'source_column_link_mismatch');
  requireSource(linkText(opportunity.sourceEventId), 'invalid_source_event_id');
  const contacts = await db.query(`SELECT r.tenant_id,r.contact_key AS id,${boundedPayload(contactSql)}
    FROM ${s}.recovery_contacts r WHERE r.tenant_id=$1 AND r.contact_key=$2 LIMIT 1`, [tenantId, opportunity.contactKey]);
  requireSource(contacts.rows.length === 1, 'source_contact_missing');
  const contact = payload(contacts.rows[0], tenantId);
  requireSource(contacts.rows[0].id === opportunity.contactKey && contact.contactKey === contacts.rows[0].id, 'source_column_id_mismatch');
  const events = await db.query(`SELECT r.tenant_id,r.event_id AS id,r.opportunity_id,r.contact_key,r.occurred_at,${boundedPayload(eventSql)}
    FROM ${s}.recovery_events r WHERE r.tenant_id=$1 AND r.event_id=$2 LIMIT 1`, [tenantId, opportunity.sourceEventId]);
  requireSource(events.rows.length === 1, 'source_event_missing');
  const eventRow = events.rows[0];
  const sourceEvent = payload(eventRow, tenantId, { legacyOwner: true });
  requireSource(sourceEvent.id === opportunity.sourceEventId && eventRow.id === sourceEvent.id, 'source_column_id_mismatch');
  optionalColumn(eventRow.opportunity_id, sourceEvent.opportunityId);
  optionalColumn(eventRow.contact_key, sourceEvent.contactKey);
  const source = { tenantId, opportunity, contact, sourceEvent };
  const inquiry = projectRecoveryInquiry(source);
  requireSource(eventRow.occurred_at !== null && Number.isFinite(new Date(eventRow.occurred_at).getTime())
    && new Date(eventRow.occurred_at).toISOString() === inquiry.receivedAt, 'source_column_time_mismatch');

  // Conservative, bounded direct-lineage exclusion. OR catches disagreement
  // between an indexed opportunity link and a JSON link for this opportunity.
  // No outcome/financial/provider fields leave the database.
  for (const [table, pk, kind] of [['recovery_events', 'event_id', 'event'], ['recovery_actions', 'action_id', 'action']]) {
    const lineage = await db.query(`SELECT r.tenant_id,r.${pk} AS id,r.opportunity_id,r.contact_key,${boundedPayload(lineageSql)}
      FROM ${s}.${table} r WHERE r.tenant_id=$1 AND (r.opportunity_id=$2 OR r.payload->>'opportunityId'=$2)
      ORDER BY r.${pk} LIMIT $3`, [tenantId, opportunityId, MAX_LINEAGE + 1]);
    requireSource(lineage.rows.length <= MAX_LINEAGE, 'source_lineage_limit_exceeded');
    for (const row of lineage.rows) lineageRow(row, tenantId, opportunityId, opportunity.contactKey, kind);
  }
  const attribution = await db.query(`SELECT r.tenant_id,r.opportunity_id AS id,${boundedPayload(lineageSql)}
    FROM ${s}.recovery_attribution r WHERE r.tenant_id=$1 AND (r.opportunity_id=$2 OR r.payload->>'opportunityId'=$2)
    ORDER BY r.opportunity_id LIMIT 2`, [tenantId, opportunityId]);
  requireSource(attribution.rows.length <= 1, 'source_lineage_link_mismatch');
  for (const row of attribution.rows) lineageRow(row, tenantId, opportunityId, opportunity.contactKey, 'attribution');
  const binding = { sourceKind: 'recovery', opportunityId, contactKey: opportunity.contactKey, sourceEventId: sourceEvent.id };
  // Fingerprints detect content change, not ordering. Freshness is the held lock
  // plus same-transaction source reads; no timestamp or sequence is a revision.
  const fingerprint = createHash('sha256').update(JSON.stringify({ binding, inquiry })).digest('hex');
  return { source, inquiry, binding, fingerprint };
}

/** Trusted server configuration only. No customer-selected tenant/schema. */
export function createPostgresRecoverySourceReader({ pool, tenantId, sourceSchema = 'bookedradar', enabled = false } = {}) {
  requireSource(enabled === true, 'source_ingestion_disabled');
  requireSource(pool && typeof pool.connect === 'function' && !pool.requiresOuterCommit, 'top_level_source_pool_required');
  requireSource(validId(tenantId), 'invalid_tenant');
  requireSource(typeof sourceSchema === 'string' && SOURCE_SCHEMA.test(sourceSchema), 'invalid_source_schema');
  async function withFencedSource(operation) {
    requireSource(typeof operation === 'function', 'source_operation_required');
    let db; let open = false; let commitAttempted = false; let broken = false; let failure;
    try {
      db = await pool.connect();
      // READ COMMITTED deliberately takes a NEW snapshot AFTER the lock wait.
      await db.query('BEGIN ISOLATION LEVEL READ COMMITTED'); open = true;
      await db.query("SET LOCAL lock_timeout='5s'");
      await db.query("SET LOCAL statement_timeout='10s'");
      await db.query("SET LOCAL idle_in_transaction_session_timeout='15s'");
      await db.query("SELECT pg_advisory_xact_lock(hashtext('br_recovery'),hashtext($1))", [tenantId]);
      const scoped = Object.freeze({
        db,
        readInquiry(opportunityId) {
          requireSource(open, 'source_transaction_closed');
          return readTriple(db, sourceSchema, tenantId, opportunityId);
        },
        async listOpportunityIds({ afterId = null, limit = 25 } = {}) {
          requireSource(open, 'source_transaction_closed');
          requireSource(afterId === null || validId(afterId), 'invalid_source_cursor');
          requireSource(Number.isSafeInteger(limit) && limit >= 1 && limit <= 25, 'invalid_source_limit');
          const { rows } = await db.query(`SELECT r.opportunity_id AS id FROM "${sourceSchema}".recovery_opportunities r
            WHERE r.tenant_id=$1 AND ($2::text IS NULL OR r.opportunity_id>$2) ORDER BY r.opportunity_id LIMIT $3`, [tenantId, afterId, limit + 1]);
          requireSource(rows.length <= limit + 1 && rows.every(row => validId(row.id)), 'invalid_source_page');
          const opportunityIds = rows.slice(0, limit).map(row => row.id);
          requireSource(new Set(opportunityIds).size === opportunityIds.length, 'invalid_source_page');
          return { opportunityIds, nextAfterId: rows.length > limit ? opportunityIds.at(-1) : null };
        },
      });
      const result = await operation(scoped);
      open = false; commitAttempted = true;
      const committed = await db.query('COMMIT');
      requireSource(committed.command === 'COMMIT', 'source_transaction_not_committed');
      return result;
    } catch (error) {
      if (commitAttempted) broken = true;
      if (db) try { await db.query('ROLLBACK'); } catch { broken = true; }
      // Never forward SQL details, parameter values or driver diagnostics.
      failure = error instanceof SourceIngestionError || error instanceof SourceProjectionError || error instanceof SourceVisibilityError
        ? error : new SourceIngestionError(commitAttempted ? 'source_commit_uncertain' : 'source_database_error');
      throw failure;
    } finally {
      open = false;
      try { db?.release(broken); } catch {
        // Cleanup must never mask a primary failure or make a possibly committed
        // mutation sound safe to replay. No automatic retry is performed.
        if (!failure) throw new SourceIngestionError(commitAttempted ? 'source_commit_uncertain' : 'source_connection_release_failed');
      }
    }
  }
  return Object.freeze({
    withFencedSource,
    readInquiry: ({ opportunityId } = {}) => withFencedSource(tx => tx.readInquiry(opportunityId)),
    listOpportunityIds: options => withFencedSource(tx => tx.listOpportunityIds(options)),
  });
}
