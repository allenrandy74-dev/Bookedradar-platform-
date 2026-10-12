// Pure shared contract. No database/network access or runtime activation.
const SCHEMA = /^bookedradar_portal(?:_test_[a-f0-9]{12})?$/;
const ALIAS = /^[a-z][a-z0-9_]{0,31}$/;
export const MAX_SOURCE_VISIBILITY_LEASE_MS = 60_000;
export const SOURCE_REJECTION_CODES = Object.freeze([
  'source_opportunity_missing', 'source_contact_missing', 'source_event_missing',
  'source_tenant_mismatch', 'invalid_source_payload', 'source_column_id_mismatch',
  'source_column_link_mismatch', 'invalid_source_event_id', 'source_column_time_mismatch',
  'source_lineage_limit_exceeded', 'source_lineage_link_mismatch', 'source_lineage_contact_mismatch',
  'source_binding_conflict', 'opportunity_required', 'contact_required', 'source_event_required',
  'source_accessor_forbidden', 'invalid_source_metadata', 'invalid_synthetic_marker',
  'source_synthetic_excluded', 'invalid_contact_key', 'contact_link_mismatch',
  'contact_is_suppression_record', 'source_event_link_mismatch', 'source_opportunity_link_mismatch',
  'invalid_source_type', 'source_type_mismatch', 'invalid_event_contact',
  'invalid_event_contact_identity', 'source_contact_link_mismatch', 'source_contact_link_unresolved',
  'invalid_contact_name', 'invalid_contact_email', 'invalid_contact_phone',
  'invalid_source', 'invalid_service_type', 'invalid_source_time',
]);
export class SourceVisibilityError extends Error {
  constructor(code) { super(code); this.name = 'SourceVisibilityError'; this.code = code; }
}
const ensure = (value, code) => { if (!value) throw new SourceVisibilityError(code); };
const fingerprint = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const instant = value => {
  ensure(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value, 'invalid_visibility_time');
  return Date.parse(value);
};
export function validateSourceVisibilityLease(leaseMs) {
  ensure(Number.isSafeInteger(leaseMs) && leaseMs >= 1000 && leaseMs <= MAX_SOURCE_VISIBILITY_LEASE_MS, 'invalid_visibility_lease');
  return leaseMs;
}

/** Add to the SAME customer SQL statement, before list LIMIT or mutation CAS. */
export function createSourceVisibilityPredicate({ schema, inquiryAlias = 'i' } = {}) {
  ensure(typeof schema === 'string' && SCHEMA.test(schema), 'invalid_visibility_schema');
  ensure(typeof inquiryAlias === 'string' && ALIAS.test(inquiryAlias), 'invalid_visibility_alias');
  const i = inquiryAlias;
  return `EXISTS (SELECT 1 FROM "${schema}".source_links sl
    JOIN "${schema}".source_visibility sv ON sv.tenant_id=sl.tenant_id AND sv.inquiry_id=sl.inquiry_id
    WHERE sl.tenant_id=${i}.tenant_id AND sl.inquiry_id=${i}.id AND sl.source_kind='recovery'
      AND sl.source_opportunity_id=${i}.id AND sv.state='active' AND sv.reason_code IS NULL
      AND sv.revision BETWEEN 1 AND 9007199254740991
      AND sv.source_fingerprint=sl.source_fingerprint AND sv.checked_at<=clock_timestamp()
      AND sv.valid_until>clock_timestamp() AND sv.valid_until<=sv.checked_at+INTERVAL '60 seconds')`;
}

/** Independent visibility revision: never changes the human inquiry version. */
export function planSourceVisibility({ previous = null, state, reasonCode = null, sourceFingerprint, checkedAt, leaseMs = MAX_SOURCE_VISIBILITY_LEASE_MS } = {}) {
  validateSourceVisibilityLease(leaseMs);
  const now = instant(checkedAt);
  ensure(['active', 'quarantined'].includes(state) && fingerprint(sourceFingerprint), 'invalid_visibility_state');
  ensure(state === 'active' ? reasonCode === null : SOURCE_REJECTION_CODES.includes(reasonCode), 'invalid_visibility_reason');
  if (previous !== null) {
    ensure(previous && Number.isSafeInteger(previous.revision) && previous.revision > 0 && fingerprint(previous.sourceFingerprint), 'invalid_visibility_state');
    const before = instant(previous.checkedAt);
    ensure(before <= now, 'visibility_time_regressed');
    ensure(previous.state === 'active' && previous.reasonCode === null && instant(previous.validUntil) > before
      && Date.parse(previous.validUntil) <= before + MAX_SOURCE_VISIBILITY_LEASE_MS
      || previous.state === 'quarantined' && SOURCE_REJECTION_CODES.includes(previous.reasonCode) && previous.validUntil === null, 'invalid_visibility_state');
    if (state === 'quarantined' && previous.state === state && previous.reasonCode === reasonCode
      && previous.sourceFingerprint === sourceFingerprint) return { kind: 'unchanged', value: { ...previous }, audit: null };
    ensure(previous.revision < Number.MAX_SAFE_INTEGER, 'visibility_revision_exhausted');
  }
  const value = { state, revision: previous ? previous.revision + 1 : 1, sourceFingerprint, checkedAt,
    validUntil: state === 'active' ? new Date(now + leaseMs).toISOString() : null, reasonCode };
  return { kind: state === 'active' ? 'verified' : 'quarantined', value,
    audit: { action: state === 'active' ? 'source.verified' : 'source.quarantined',
      previousRevision: previous?.revision ?? null, revision: value.revision, previousState: previous?.state ?? null,
      state, checkedAt, validUntil: value.validUntil, reasonCode } };
}
