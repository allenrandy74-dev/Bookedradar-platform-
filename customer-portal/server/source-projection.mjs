// Pure, inactive projection only. No source-store imports, I/O, customer auth,
// provider dispatch, consent, booking, or revenue mutations live in this module.
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const STATUSES = new Set(['new', 'in_progress', 'waiting', 'closed']);
export const SOURCE_FIELDS = Object.freeze(['customerName', 'contact.email', 'contact.phone', 'subject', 'source', 'receivedAt']);

export class SourceProjectionError extends Error {
  constructor(code) { super(code); this.name = 'SourceProjectionError'; this.code = code; }
}
const ensure = (condition, code) => { if (!condition) throw new SourceProjectionError(code); };
const validId = value => typeof value === 'string' && ID.test(value);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
// Never read inherited properties or invoke accessors, even for an allowed key.
function field(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  ensure(!descriptor || Object.hasOwn(descriptor, 'value'), 'source_accessor_forbidden');
  return descriptor?.value;
}
function text(value, max, code, optional = false) {
  if (optional && value === undefined) return '';
  ensure(typeof value === 'string' && value.length <= max && !CONTROL.test(value), code);
  return value;
}
function requiredText(value, max, code) {
  const result = text(value, max, code);
  ensure(result.trim().length > 0, code);
  return result;
}
function instant(value, code, allowEpoch = false) {
  if (allowEpoch && typeof value === 'number') {
    ensure(Number.isSafeInteger(value) && value >= 0 && value <= 253402300799999, code);
    return new Date(value).toISOString();
  }
  ensure(typeof value === 'string', code);
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/);
  ensure(match, code);
  const [, year, month, day, hour, minute, second, , zone] = match;
  const leap = Number(year) % 4 === 0 && (Number(year) % 100 !== 0 || Number(year) % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  ensure(Number(year) >= 1 && Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1
    && Number(day) <= days[Number(month) - 1] && Number(hour) < 24 && Number(minute) < 60
    && Number(second) < 60 && (zone === 'Z' || Number(zone.slice(1, 3)) < 24 && Number(zone.slice(4)) < 60)
    && Number.isFinite(Date.parse(value)), code);
  const normalized = new Date(value).toISOString();
  ensure(/^\d{4}-/.test(normalized), code);
  return normalized;
}
function synthetic(value) {
  const direct = field(value, 'synthetic');
  const metadata = field(value, 'metadata');
  ensure(metadata === undefined || record(metadata), 'invalid_source_metadata');
  const nested = metadata === undefined ? undefined : field(metadata, 'synthetic');
  ensure([direct, nested].every(marker => marker === undefined || typeof marker === 'boolean'), 'invalid_synthetic_marker');
  // Matches the existing reporting rule: an explicit true wins over false.
  return direct === true || nested === true;
}

/**
 * Map a trusted server-selected, coherently read source triple to minimal source
 * columns. This validates identity; it does not establish who may read a tenant.
 * Missing/pruned source events, unresolved ownership, and bad links fail closed.
 * No call transcript, arbitrary metadata/notes, outcome, or financial field is
 * inferred. See SOURCE_MAPPING.md for the deliberately separate writer boundary.
 */
export function projectRecoveryInquiry({ tenantId, opportunity, contact, sourceEvent } = {}) {
  ensure(validId(tenantId), 'invalid_tenant');
  ensure(record(opportunity), 'opportunity_required');
  ensure(record(contact), 'contact_required');
  ensure(record(sourceEvent), 'source_event_required');
  for (const item of [opportunity, contact, sourceEvent]) {
    ensure(field(item, 'tenantId') === tenantId, 'source_tenant_mismatch');
  }
  const id = field(opportunity, 'id');
  ensure(validId(id), 'invalid_opportunity_id');
  const contactKey = requiredText(field(opportunity, 'contactKey'), 512, 'invalid_contact_key');
  ensure(contactKey.startsWith(`${tenantId}:`) && contactKey.length > tenantId.length + 1
    && !contactKey.startsWith(`${tenantId}:suppressed-recipient:`), 'invalid_contact_key');
  ensure(field(contact, 'contactKey') === contactKey, 'contact_link_mismatch');
  ensure(field(contact, 'kind') !== 'recipient_suppression', 'contact_is_suppression_record');
  const sourceEventId = requiredText(field(opportunity, 'sourceEventId'), 512, 'invalid_source_event_id');
  ensure(field(sourceEvent, 'id') === sourceEventId, 'source_event_link_mismatch');
  const explicitOpportunityId = field(sourceEvent, 'opportunityId');
  ensure(explicitOpportunityId === undefined || explicitOpportunityId === id, 'source_opportunity_link_mismatch');
  const type = requiredText(field(opportunity, 'type'), 80, 'invalid_source_type');
  ensure(field(sourceEvent, 'type') === type, 'source_type_mismatch');

  // Reproduce RecoveryEngine's creation-time identity precedence. Source-event
  // contact data is used for link validation only; current contact owns display.
  const eventContact = field(sourceEvent, 'contact');
  ensure(eventContact === undefined || record(eventContact), 'invalid_event_contact');
  const ec = eventContact ?? Object.create(null);
  const embeddedTenant = field(ec, 'tenantId');
  ensure(embeddedTenant === undefined || embeddedTenant === tenantId, 'source_tenant_mismatch');
  const keys = [field(sourceEvent, 'contactKey'), field(ec, 'externalId'), field(ec, 'phone'), field(ec, 'email')];
  for (const value of keys) if (value !== undefined) text(value, 512, 'invalid_event_contact_identity');
  const rawKey = keys.find(value => value);
  if (rawKey !== undefined) {
    const namespaced = rawKey.startsWith(`${tenantId}:`) ? rawKey : `${tenantId}:${rawKey}`;
    ensure(namespaced === contactKey, 'source_contact_link_mismatch');
  } else ensure(new RegExp(`^${tenantId}:anonymous:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`, 'i').test(contactKey), 'source_contact_link_unresolved');
  // A contactKey nested in event.contact is not the engine's identity selector.
  // If present, it still cannot contradict the authoritative linked contact.
  const embeddedKey = field(ec, 'contactKey');
  if (embeddedKey !== undefined) {
    requiredText(embeddedKey, 512, 'invalid_event_contact_identity');
    ensure((embeddedKey.startsWith(`${tenantId}:`) ? embeddedKey : `${tenantId}:${embeddedKey}`) === contactKey, 'source_contact_link_mismatch');
  }
  // Also quarantine an explicitly marked contact. Reporting currently centers
  // on opportunity/event lineage; a marked customer contact is not safe to show.
  ensure(!synthetic(opportunity) && !synthetic(sourceEvent) && !synthetic(contact), 'source_synthetic_excluded');

  const name = text(field(contact, 'name'), 200, 'invalid_contact_name', true).trim();
  const firstName = text(field(contact, 'firstName'), 200, 'invalid_contact_name', true).trim();
  const lastName = text(field(contact, 'lastName'), 200, 'invalid_contact_name', true).trim();
  const customerName = name || [firstName, lastName].filter(Boolean).join(' ');
  text(customerName, 200, 'invalid_contact_name');
  // A nonempty source is persisted by RecoveryEngine. Do not fabricate one if
  // historical data is malformed or map the source string to a delivery channel.
  const source = requiredText(field(opportunity, 'source'), 80, 'invalid_source');
  return {
    id, tenantId, customerName,
    contact: {
      email: text(field(contact, 'email'), 320, 'invalid_contact_email', true),
      phone: text(field(contact, 'phone'), 80, 'invalid_contact_phone', true),
    },
    subject: text(field(opportunity, 'serviceType'), 300, 'invalid_service_type', true),
    summary: '',
    source,
    receivedAt: instant(field(sourceEvent, 'occurredAt'), 'invalid_source_time', true),
  };
}

function workflow(existing, tenantId, inquiryId) {
  ensure(record(existing) && field(existing, 'tenantId') === tenantId, 'existing_tenant_mismatch');
  ensure(field(existing, 'id') === inquiryId, 'existing_inquiry_mismatch');
  const status = field(existing, 'status');
  const assigneeId = field(existing, 'assigneeId');
  const version = field(existing, 'version');
  ensure(STATUSES.has(status) && (assigneeId === null || validId(assigneeId))
    && Number.isSafeInteger(version) && version > 0, 'invalid_existing_workflow');
  const notes = field(existing, 'notes');
  ensure(Array.isArray(notes) && notes.length <= 1000, 'invalid_existing_notes');
  const ids = new Set();
  const copiedNotes = notes.map(note => {
    ensure(record(note) && field(note, 'tenantId') === tenantId && field(note, 'inquiryId') === inquiryId, 'existing_note_link_mismatch');
    const id = field(note, 'id'); const authorId = field(note, 'authorId');
    ensure(validId(id) && validId(authorId) && !ids.has(id), 'invalid_existing_notes');
    ids.add(id);
    const noteText = requiredText(field(note, 'text'), 2000, 'invalid_existing_notes');
    instant(field(note, 'createdAt'), 'invalid_existing_notes');
    return { id, tenantId, inquiryId, authorId, text: noteText, createdAt: field(note, 'createdAt') };
  });
  instant(field(existing, 'updatedAt'), 'invalid_existing_time');
  return { status, assigneeId, version, notes: copiedNotes, updatedAt: field(existing, 'updatedAt') };
}
function priorSource(existing) {
  const contact = field(existing, 'contact');
  ensure(record(contact), 'invalid_existing_source');
  return {
    customerName: text(field(existing, 'customerName'), 200, 'invalid_existing_source'),
    contact: { email: text(field(contact, 'email'), 320, 'invalid_existing_source'), phone: text(field(contact, 'phone'), 80, 'invalid_existing_source') },
    subject: text(field(existing, 'subject'), 300, 'invalid_existing_source'),
    summary: text(field(existing, 'summary'), 4000, 'invalid_existing_source'),
    source: text(field(existing, 'source'), 80, 'invalid_existing_source'),
    receivedAt: instant(field(existing, 'receivedAt'), 'invalid_existing_source'),
  };
}
function sourceValue(source, key) {
  if (key === 'contact.email') return source.contact.email;
  if (key === 'contact.phone') return source.contact.phone;
  return source[key];
}

/**
 * Produce a plan only. The existing customer store MUST NOT execute this plan:
 * its saveInquiry/appendAudit intentionally forbid source writes/service actors.
 * A future approved importer needs source-read fencing, compare-and-swap and an
 * atomic dedicated source audit. expectedVersion is null only for an insert.
 */
export function planInquirySourceRefresh({ tenantId, opportunity, contact, sourceEvent, existing = null, expectedVersion = null, refreshedAt } = {}) {
  const source = projectRecoveryInquiry({ tenantId, opportunity, contact, sourceEvent });
  const at = instant(refreshedAt, 'invalid_refresh_time');
  let previous = null; let previousSource = null;
  if (existing !== null) {
    previous = workflow(existing, tenantId, source.id);
    previousSource = priorSource(existing);
    ensure(expectedVersion === previous.version, 'version_conflict');
    ensure(Date.parse(at) >= Date.parse(previous.updatedAt), 'refresh_time_precedes_record');
  } else ensure(expectedVersion === null, 'version_conflict');
  const changedFields = previous === null ? [...SOURCE_FIELDS]
    : SOURCE_FIELDS.filter(key => sourceValue(source, key) !== sourceValue(previousSource, key));
  const changed = changedFields.length > 0;
  ensure(!previous || !changed || previous.version < Number.MAX_SAFE_INTEGER, 'version_exhausted');
  const inquiry = {
    id: source.id, tenantId, customerName: source.customerName,
    contact: { email: source.contact.email, phone: source.contact.phone },
    // No reliable source-summary field is established. Initialize empty, but do
    // not erase a pre-existing summary supplied by a separately approved mapper.
    subject: source.subject, summary: previous ? previousSource.summary : '', source: source.source,
    receivedAt: !changed && previous ? field(existing, 'receivedAt') : source.receivedAt,
    updatedAt: changed ? at : previous.updatedAt,
    status: previous ? previous.status : 'new',
    assigneeId: previous ? previous.assigneeId : null,
    version: previous ? previous.version + Number(changed) : 1,
    notes: previous ? previous.notes : [],
  };
  return {
    kind: previous === null ? 'create' : changed ? 'refresh' : 'unchanged',
    expectedVersion, inquiry,
    audit: changed ? {
      tenantId, inquiryId: source.id,
      action: previous === null ? 'inquiry.source_created' : 'inquiry.source_refreshed',
      fields: changedFields, previousVersion: previous ? previous.version : null,
      version: inquiry.version, occurredAt: at,
    } : null,
  };
}
