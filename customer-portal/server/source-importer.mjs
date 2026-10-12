// INACTIVE LIBRARY. No runtime registration, pool creation or activation.
import { randomUUID } from 'node:crypto';
import { createPostgresRecoverySourceReader, requireSource, SourceIngestionError } from './source-reader.mjs';
import { planInquirySourceRefresh, SourceProjectionError } from './source-projection.mjs';
import { SOURCE_REJECTION_CODES, MAX_SOURCE_VISIBILITY_LEASE_MS, validateSourceVisibilityLease, planSourceVisibility } from './source-visibility.mjs';

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
const visibilityDto = row => row ? ({ state: row.state, revision: Number(row.revision), sourceFingerprint: row.source_fingerprint,
  checkedAt: iso(row.checked_at), validUntil: row.valid_until === null ? null : iso(row.valid_until), reasonCode: row.reason_code }) : null;
const knownRejection = error => (error instanceof SourceIngestionError || error instanceof SourceProjectionError) && SOURCE_REJECTION_CODES.includes(error.code);
const bump = version => { requireSource(Number.isSafeInteger(version) && version < Number.MAX_SAFE_INTEGER, 'version_exhausted'); return version + 1; };

/** Trusted internal ID/version invocation only; no detached source snapshot. */
export function createPostgresSourceImporter({ pool, tenantId, portalSchema = 'bookedradar_portal', sourceSchema = 'bookedradar', enabled = false,
  visibilityLeaseMs = MAX_SOURCE_VISIBILITY_LEASE_MS } = {}) {
  const reader = createPostgresRecoverySourceReader({ pool, tenantId, sourceSchema, enabled });
  requireSource(typeof portalSchema === 'string' && PORTAL_SCHEMA.test(portalSchema), 'invalid_portal_schema');
  validateSourceVisibilityLease(visibilityLeaseMs);
  const s = `"${portalSchema}"`;
  return Object.freeze({
    listOpportunityIds: reader.listOpportunityIds,
    async importInquiry({ opportunityId, expectedVersion } = {}) {
      requireSource(typeof opportunityId === 'string' && ID.test(opportunityId), 'invalid_opportunity_id');
      requireSource(expectedVersion === null || Number.isSafeInteger(expectedVersion) && expectedVersion > 0, 'expected_version_required');
      return reader.withFencedSource(async ({ db, readInquiry }) => {
        const tenant = await db.query(`SELECT id FROM ${s}.tenants WHERE id=$1 AND active=true FOR SHARE`, [tenantId]);
        requireSource(tenant.rows.length === 1, 'portal_tenant_inactive');
        // The recovery fence is already held. Every quarantine/restore and human
        // workflow change now serializes on the same portal parent lock.
        const locked = await db.query(`SELECT id FROM ${s}.inquiries WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenantId, opportunityId]);
        requireSource(locked.rows.length <= 1, 'invalid_portal_row');
        const current = await db.query(`SELECT i.id,i.tenant_id,i.customer_name,i.contact_email,i.contact_phone,i.subject,i.summary,i.source,
          i.received_at,i.updated_at,i.status,i.assignee_id,i.version,
          COALESCE((SELECT jsonb_agg(n ORDER BY n.created_at,n.id) FROM
            (SELECT n.id,n.tenant_id,n.inquiry_id,n.author_id,n.text,n.created_at FROM ${s}.notes n
              WHERE n.tenant_id=i.tenant_id AND n.inquiry_id=i.id ORDER BY n.created_at,n.id LIMIT 1001) n), '[]'::jsonb) AS notes
          FROM ${s}.inquiries i WHERE i.tenant_id=$1 AND i.id=$2`, [tenantId, opportunityId]);
        requireSource(current.rows.length === locked.rows.length, 'portal_insert_conflict');
        const existing = existingInquiry(current.rows[0]);
        const links = await db.query(`SELECT tenant_id,inquiry_id,source_kind,source_opportunity_id,source_contact_key,source_event_id,source_fingerprint,first_imported_at,last_observed_at
          FROM ${s}.source_links WHERE tenant_id=$1 AND inquiry_id=$2 FOR UPDATE`, [tenantId, opportunityId]);
        requireSource(links.rows.length <= 1, 'invalid_source_binding');
        const oldLink = links.rows[0];
        if (existing) requireSource(oldLink, 'source_binding_missing');
        else requireSource(!oldLink, 'source_binding_conflict');
        const visibility = await db.query(`SELECT tenant_id,inquiry_id,state,revision,source_fingerprint,checked_at,valid_until,reason_code
          FROM ${s}.source_visibility WHERE tenant_id=$1 AND inquiry_id=$2 FOR UPDATE`, [tenantId, opportunityId]);
        requireSource(visibility.rows.length <= 1, 'invalid_visibility_state');
        const previousVisibility = visibilityDto(visibility.rows[0]);
        requireSource(existing || previousVisibility === null, 'invalid_visibility_state');
        const observedAt = async () => iso((await db.query('SELECT clock_timestamp() AS observed_at')).rows[0]?.observed_at);
        async function versionOnly(version, at) {
          requireSource(Date.parse(at) >= Date.parse(existing.updatedAt), 'refresh_time_precedes_record');
          const updated = await db.query(`UPDATE ${s}.inquiries SET version=$3,updated_at=$4 WHERE tenant_id=$1 AND id=$2 AND version=$5`,
            [tenantId, opportunityId, version, at, existing.version]);
          requireSource(updated.rowCount === 1, 'version_conflict');
        }
        async function persistVisibility(plan, previousVersion, version) {
          if (!plan.audit) return;
          const v = plan.value;
          if (previousVisibility) {
            const updated = await db.query(`UPDATE ${s}.source_visibility SET state=$3,revision=$4,source_fingerprint=$5,checked_at=$6,valid_until=$7,reason_code=$8
              WHERE tenant_id=$1 AND inquiry_id=$2 AND revision=$9`,
            [tenantId, opportunityId, v.state, v.revision, v.sourceFingerprint, v.checkedAt, v.validUntil, v.reasonCode, previousVisibility.revision]);
            requireSource(updated.rowCount === 1, 'visibility_revision_conflict');
          } else {
            const inserted = await db.query(`INSERT INTO ${s}.source_visibility
              (tenant_id,inquiry_id,state,revision,source_fingerprint,checked_at,valid_until,reason_code)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (tenant_id,inquiry_id) DO NOTHING RETURNING inquiry_id`,
            [tenantId, opportunityId, v.state, v.revision, v.sourceFingerprint, v.checkedAt, v.validUntil, v.reasonCode]);
            requireSource(inserted.rowCount === 1, 'visibility_revision_conflict');
          }
          const a = plan.audit;
          await db.query(`INSERT INTO ${s}.source_visibility_audit
            (tenant_id,inquiry_id,id,service_actor,action,previous_revision,revision,previous_state,state,reason_code,checked_at,valid_until,previous_version,version)
            VALUES ($1,$2,$3,'recovery_importer_v1',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [tenantId, opportunityId, randomUUID(), a.action, a.previousRevision, a.revision, a.previousState, a.state, a.reasonCode,
            a.checkedAt, a.validUntil, previousVersion, version]);
        }

        let loaded;
        try {
          loaded = await readInquiry(opportunityId);
          if (existing) requireSource(oldLink.tenant_id === tenantId && oldLink.inquiry_id === opportunityId
            && oldLink.source_kind === loaded.binding.sourceKind && oldLink.source_opportunity_id === loaded.binding.opportunityId
            && oldLink.source_contact_key === loaded.binding.contactKey && oldLink.source_event_id === loaded.binding.sourceEventId, 'source_binding_conflict');
        } catch (error) {
          // Only fixed, deterministic source validation failures can quarantine
          // an already bound record. SQL/connection errors cannot claim safety.
          if (!existing || !oldLink || !knownRejection(error)) throw error;
          const at = await observedAt();
          const plan = planSourceVisibility({ previous: previousVisibility, state: 'quarantined', reasonCode: error.code,
            sourceFingerprint: oldLink.source_fingerprint, checkedAt: at, leaseMs: visibilityLeaseMs });
          const version = previousVisibility?.state === 'active' ? bump(existing.version) : existing.version;
          if (version !== existing.version) await versionOnly(version, at);
          await persistVisibility(plan, existing.version, version);
          // Intentionally ignores stale workflow expectedVersion only on this
          // safety transition. No workflow field or durable source link changes.
          return { kind: 'quarantined', inquiryId: opportunityId, version, reasonCode: error.code };
        }
        requireSource(existing ? expectedVersion === existing.version : expectedVersion === null, 'version_conflict');
        const { source, binding, fingerprint } = loaded;
        const refreshedAt = await observedAt();
        if (oldLink) requireSource(Date.parse(refreshedAt) >= new Date(oldLink.last_observed_at).getTime(), 'source_observation_time_regressed');
        const plan = planInquirySourceRefresh({ ...source, existing, expectedVersion, refreshedAt });
        const next = plan.inquiry;
        const restoring = previousVisibility?.state === 'quarantined';
        if (restoring && plan.kind === 'unchanged') {
          next.version = bump(existing.version); next.updatedAt = refreshedAt;
          await versionOnly(next.version, refreshedAt);
        }
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
        const visibilityPlan = planSourceVisibility({ previous: previousVisibility, state: 'active', sourceFingerprint: fingerprint,
          checkedAt: refreshedAt, leaseMs: visibilityLeaseMs });
        await persistVisibility(visibilityPlan, existing?.version ?? null, next.version);
        return { kind: restoring ? 'restored' : plan.kind, inquiryId: next.id, version: next.version };
      });
    },
  });
}
