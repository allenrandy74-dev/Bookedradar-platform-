// INACTIVE LIBRARY: this module is not imported by a runtime or route. It only
// accepts a trusted, explicitly enabled server configuration and injected pool.
import { randomUUID } from 'node:crypto';
import { createPostgresRecoverySourceReader, requireSource } from './source-reader.mjs';
import { planInquirySourceRefresh } from './source-projection.mjs';

const PORTAL_SCHEMA = /^bookedradar_portal(?:_test_[a-f0-9]{12})?$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const iso = value => value instanceof Date ? value.toISOString() : new Date(value).toISOString();
function existingInquiry(row) {
  if (!row) return null;
  return {
    id: row.id, tenantId: row.tenant_id, customerName: row.customer_name,
    contact: { email: row.contact_email, phone: row.contact_phone },
    subject: row.subject, summary: row.summary, source: row.source,
    receivedAt: iso(row.received_at), updatedAt: iso(row.updated_at), status: row.status,
    assigneeId: row.assignee_id, version: Number(row.version),
    notes: (row.notes || []).map(note => ({ id: note.id, tenantId: note.tenant_id,
      inquiryId: note.inquiry_id, authorId: note.author_id, text: note.text, createdAt: iso(note.created_at) })),
  };
}

/**
 * The only import input is an ID + portal expectedVersion. No supplied source
 * object, timestamp, fingerprint, checkpoint, raw snapshot or service actor is
 * accepted. Every call freshly reads and commits under the real recovery lock.
 * enabled defaults to false. A true flag is not authorization for live use.
 */
export function createPostgresSourceImporter({ pool, tenantId, portalSchema = 'bookedradar_portal', sourceSchema = 'bookedradar', enabled = false } = {}) {
  const reader = createPostgresRecoverySourceReader({ pool, tenantId, sourceSchema, enabled });
  requireSource(typeof portalSchema === 'string' && PORTAL_SCHEMA.test(portalSchema), 'invalid_portal_schema');
  const s = `"${portalSchema}"`;
  return Object.freeze({
    listOpportunityIds: reader.listOpportunityIds,
    async importInquiry({ opportunityId, expectedVersion } = {}) {
      requireSource(typeof opportunityId === 'string' && ID.test(opportunityId), 'invalid_opportunity_id');
      requireSource(expectedVersion === null || Number.isSafeInteger(expectedVersion) && expectedVersion > 0, 'expected_version_required');
      return reader.withFencedSource(async ({ db, readInquiry }) => {
        const tenant = await db.query(`SELECT id FROM ${s}.tenants WHERE id=$1 AND active=true FOR SHARE`, [tenantId]);
        requireSource(tenant.rows.length === 1, 'portal_tenant_inactive');
        // Read source only after the recovery advisory fence is acquired. Source
        // freshness is held until this same transaction finishes.
        const { source, binding, fingerprint } = await readInquiry(opportunityId);
        const locked = await db.query(`SELECT id FROM ${s}.inquiries WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenantId, opportunityId]);
        requireSource(locked.rows.length <= 1, 'invalid_portal_row');
        // A fresh statement AFTER waiting on the parent lock sees a just-added
        // note consistently. Human note writers hold this same parent row lock.
        const current = await db.query(`SELECT i.id,i.tenant_id,i.customer_name,i.contact_email,i.contact_phone,i.subject,i.summary,i.source,
          i.received_at,i.updated_at,i.status,i.assignee_id,i.version,
          COALESCE((SELECT jsonb_agg(n ORDER BY n.created_at,n.id) FROM
            (SELECT n.id,n.tenant_id,n.inquiry_id,n.author_id,n.text,n.created_at FROM ${s}.notes n
              WHERE n.tenant_id=i.tenant_id AND n.inquiry_id=i.id ORDER BY n.created_at,n.id LIMIT 1001) n), '[]'::jsonb) AS notes
          FROM ${s}.inquiries i WHERE i.tenant_id=$1 AND i.id=$2`, [tenantId, opportunityId]);
        requireSource(current.rows.length === locked.rows.length, 'portal_insert_conflict');
        const existing = existingInquiry(current.rows[0]);
        requireSource(existing ? expectedVersion === existing.version : expectedVersion === null, 'version_conflict');
        const links = await db.query(`SELECT tenant_id,inquiry_id,source_kind,source_opportunity_id,source_contact_key,source_event_id,source_fingerprint,first_imported_at,last_observed_at
          FROM ${s}.source_links WHERE tenant_id=$1 AND inquiry_id=$2 FOR UPDATE`, [tenantId, opportunityId]);
        requireSource(links.rows.length <= 1, 'invalid_source_binding');
        const oldLink = links.rows[0];
        if (existing) {
          requireSource(oldLink, 'source_binding_missing');
          requireSource(oldLink.tenant_id === tenantId && oldLink.inquiry_id === opportunityId
            && oldLink.source_kind === binding.sourceKind && oldLink.source_opportunity_id === binding.opportunityId
            && oldLink.source_contact_key === binding.contactKey && oldLink.source_event_id === binding.sourceEventId, 'source_binding_conflict');
        } else requireSource(!oldLink, 'source_binding_conflict');
        // clock_timestamp(), not transaction-start CURRENT_TIMESTAMP. Waiting on
        // a human workflow lock must not make refreshedAt predate that edit.
        const observed = await db.query('SELECT clock_timestamp() AS observed_at');
        const refreshedAt = iso(observed.rows[0]?.observed_at);
        if (oldLink) requireSource(Date.parse(refreshedAt) >= new Date(oldLink.last_observed_at).getTime(), 'source_observation_time_regressed');
        const plan = planInquirySourceRefresh({ ...source, existing, expectedVersion, refreshedAt });
        const next = plan.inquiry;
        if (plan.kind === 'create') {
          const inserted = await db.query(`INSERT INTO ${s}.inquiries
            (tenant_id,id,customer_name,contact_email,contact_phone,subject,summary,source,received_at,updated_at,status,assignee_id,version)
            VALUES ($1,$2,$3,$4,$5,$6,'',$7,$8,$9,'new',NULL,1) ON CONFLICT (tenant_id,id) DO NOTHING RETURNING id`,
          [tenantId, next.id, next.customerName, next.contact.email, next.contact.phone, next.subject, next.source, next.receivedAt, next.updatedAt]);
          requireSource(inserted.rowCount === 1, 'portal_insert_conflict');
          await db.query(`INSERT INTO ${s}.source_links
            (tenant_id,inquiry_id,source_kind,source_opportunity_id,source_contact_key,source_event_id,source_fingerprint,first_imported_at,last_observed_at)
            VALUES ($1,$2,'recovery',$2,$3,$4,$5,$6,$6)`, [tenantId, next.id, binding.contactKey, binding.sourceEventId, fingerprint, refreshedAt]);
        } else {
          if (plan.kind === 'refresh') {
            // Deliberately omit summary, status, assignee and notes. Source never
            // owns those fields, even if a caller attempted to supply them.
            const updated = await db.query(`UPDATE ${s}.inquiries SET customer_name=$3,contact_email=$4,contact_phone=$5,subject=$6,source=$7,received_at=$8,updated_at=$9,version=$10
              WHERE tenant_id=$1 AND id=$2 AND version=$11`, [tenantId, next.id, next.customerName, next.contact.email, next.contact.phone,
              next.subject, next.source, next.receivedAt, next.updatedAt, next.version, expectedVersion]);
            requireSource(updated.rowCount === 1, 'version_conflict');
          }
          const observedLink = await db.query(`UPDATE ${s}.source_links SET source_fingerprint=$3,last_observed_at=$4
            WHERE tenant_id=$1 AND inquiry_id=$2 AND source_fingerprint=$5`, [tenantId, next.id, fingerprint, refreshedAt, oldLink.source_fingerprint]);
          requireSource(observedLink.rowCount === 1, 'source_binding_conflict');
        }
        if (plan.audit) {
          const audit = plan.audit;
          await db.query(`INSERT INTO ${s}.source_ingestion_audit
            (tenant_id,inquiry_id,id,service_actor,action,fields,previous_version,version,occurred_at)
            VALUES ($1,$2,$3,'recovery_importer_v1',$4,$5,$6,$7,$8)`,
          [tenantId, next.id, randomUUID(), audit.action, audit.fields, audit.previousVersion, audit.version, audit.occurredAt]);
        }
        // Return no raw contact, receipt, lineage or internal fingerprint.
        return { kind: plan.kind, inquiryId: next.id, version: next.version };
      });
    },
  });
}
