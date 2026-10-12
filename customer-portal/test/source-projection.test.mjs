import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { projectRecoveryInquiry, planInquirySourceRefresh, SOURCE_FIELDS, SourceProjectionError } from '../server/source-projection.mjs';

const T0 = '2026-10-12T09:00:00.000Z';
const T1 = '2026-10-12T10:00:00.000Z';
const T2 = '2026-10-12T11:00:00.000Z';
function sources() {
  return {
    tenantId: 'tenant_a',
    opportunity: {
      id: 'opp_a', tenantId: 'tenant_a', contactKey: 'tenant_a:crm_1', sourceEventId: 'evt_a',
      type: 'phone_lead', source: 'ai_phone_operator', serviceType: 'Furnace inspection',
      createdAt: T1, updatedAt: T1, status: 'open',
    },
    contact: { tenantId: 'tenant_a', contactKey: 'tenant_a:crm_1', name: 'Synthetic Customer', phone: '+15550100101', email: 'inquiry@example.test', updatedAt: T1 },
    sourceEvent: { id: 'evt_a', tenantId: 'tenant_a', type: 'phone_lead', occurredAt: T0, contact: { externalId: 'crm_1' } },
  };
}
function existing() {
  return {
    ...projectRecoveryInquiry(sources()),
    status: 'waiting', assigneeId: 'member_a', version: 7, updatedAt: T1,
    notes: [{ id: 'note_a', tenantId: 'tenant_a', inquiryId: 'opp_a', authorId: 'member_b', text: 'Synthetic internal note', createdAt: T1 }],
  };
}
function fail(input, code, operation = projectRecoveryInquiry) {
  assert.throws(() => operation(input), error => error instanceof SourceProjectionError && error.code === code && error.message === code);
}
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

test('maps actual linked recovery fields to exactly the minimal source shape', () => {
  const output = projectRecoveryInquiry(sources());
  assert.deepEqual(output, {
    id: 'opp_a', tenantId: 'tenant_a', customerName: 'Synthetic Customer',
    contact: { email: 'inquiry@example.test', phone: '+15550100101' },
    subject: 'Furnace inspection', summary: '', source: 'ai_phone_operator', receivedAt: T0,
  });
  assert.equal(output.receivedAt, T0, 'source receipt time, never opportunity persistence time');
  assert.equal(output.status, undefined);
});

test('uses only current contact and opportunity values; never invents missing name, channel or summary', () => {
  const input = sources();
  delete input.contact.name;
  input.contact.firstName = ' Synthetic ';
  input.contact.lastName = ' Customer ';
  input.sourceEvent.contact.name = 'Old name';
  input.sourceEvent.serviceType = 'Old service';
  input.sourceEvent.source = 'Old channel';
  input.opportunity.summary = 'Unapproved summary';
  input.opportunity.metadata = { notes: 'Private raw note', summary: 'Raw transcript summary', serviceAddress: 'Private address' };
  assert.equal(projectRecoveryInquiry(input).customerName, 'Synthetic Customer');
  assert.equal(projectRecoveryInquiry(input).subject, 'Furnace inspection');
  assert.equal(projectRecoveryInquiry(input).source, 'ai_phone_operator');
  assert.equal(projectRecoveryInquiry(input).summary, '');
  delete input.contact.firstName; delete input.contact.lastName;
  delete input.contact.email; delete input.contact.phone; delete input.opportunity.serviceType;
  const empty = projectRecoveryInquiry(input);
  assert.equal(empty.customerName, ''); assert.equal(empty.subject, '');
  assert.deepEqual(empty.contact, { email: '', phone: '' });
});

test('accepts engine identity precedence, namespacing and a truly anonymous creation receipt', () => {
  for (const [eventContact, key] of [
    [{ externalId: 'crm_1', phone: '+15550100102' }, 'tenant_a:crm_1'],
    [{ phone: '+15550100102', email: 'other@example.test' }, 'tenant_a:+15550100102'],
    [{ email: 'only@example.test' }, 'tenant_a:only@example.test'],
    [{ externalId: 'tenant_a:already_scoped' }, 'tenant_a:already_scoped'],
    [{}, 'tenant_a:anonymous:11111111-2222-4333-8444-555555555555'],
  ]) {
    const input = sources();
    input.sourceEvent.contact = eventContact;
    input.opportunity.contactKey = key; input.contact.contactKey = key;
    assert.equal(projectRecoveryInquiry(input).id, 'opp_a');
  }
  const input = sources();
  input.sourceEvent.contactKey = 'crm_1';
  input.sourceEvent.contact.externalId = 'ignored_lower_priority';
  assert.equal(projectRecoveryInquiry(input).id, 'opp_a');
  delete input.sourceEvent.contactKey; input.sourceEvent.contact = {};
  fail(input, 'source_contact_link_unresolved');
});

test('rejects missing or malformed records instead of degrading identity checks', () => {
  for (const [key, code] of [['opportunity', 'opportunity_required'], ['contact', 'contact_required'], ['sourceEvent', 'source_event_required']]) {
    for (const bad of [undefined, null, [], 'secret', 7, new Date(), Object.create({ tenantId: 'tenant_a' })]) {
      const input = sources(); input[key] = bad; fail(input, code);
    }
  }
  fail(sourcesWith('tenantId', ''), 'invalid_tenant');
  fail(sourcesWith('tenantId', 'a/b'), 'invalid_tenant');
  for (const bad of [null, undefined, [], 42, '', '   ', 'x'.repeat(81), 'phone\u0000secret']) {
    const input = sources(); input.opportunity.source = bad; fail(input, 'invalid_source');
  }
});
function sourcesWith(key, value) { const input = sources(); input[key] = value; return input; }

test('rejects missing ownership or mismatched tenants on every linked record', () => {
  for (const key of ['opportunity', 'contact', 'sourceEvent']) {
    for (const tenant of [undefined, '', 'tenant_b']) {
      const input = sources(); input[key].tenantId = tenant; fail(input, 'source_tenant_mismatch');
    }
  }
  const embedded = sources(); embedded.sourceEvent.contact.tenantId = 'tenant_b';
  fail(embedded, 'source_tenant_mismatch');
});

test('rejects mismatched object, source, contact, event type, or suppression links', () => {
  for (const [change, code] of [
    [input => { input.opportunity.id = 'id/invalid'; }, 'invalid_opportunity_id'],
    [input => { input.opportunity.sourceEventId = ''; }, 'invalid_source_event_id'],
    [input => { input.sourceEvent.id = 'evt_other'; }, 'source_event_link_mismatch'],
    [input => { input.sourceEvent.opportunityId = 'opp_other'; }, 'source_opportunity_link_mismatch'],
    [input => { input.contact.contactKey = 'tenant_a:other'; }, 'contact_link_mismatch'],
    [input => { input.opportunity.contactKey = 'tenant_b:crm_1'; input.contact.contactKey = 'tenant_b:crm_1'; }, 'invalid_contact_key'],
    [input => { input.opportunity.contactKey = 'tenant_a:suppressed-recipient:phone:test'; }, 'invalid_contact_key'],
    [input => { input.contact.kind = 'recipient_suppression'; }, 'contact_is_suppression_record'],
    [input => { input.opportunity.type = ''; }, 'invalid_source_type'],
    [input => { input.sourceEvent.type = 'web_lead'; }, 'source_type_mismatch'],
    [input => { input.sourceEvent.contact.externalId = 'crm_other'; }, 'source_contact_link_mismatch'],
    [input => { input.sourceEvent.contact.contactKey = 'tenant_b:crm_1'; }, 'source_contact_link_mismatch'],
    [input => { input.sourceEvent.contact = []; }, 'invalid_event_contact'],
    [input => { input.sourceEvent.contact.externalId = { secret: true }; }, 'invalid_event_contact_identity'],
  ]) {
    const input = sources(); change(input); fail(input, code);
  }
});

test('strips secret, provider, consent, booking, result and poison fields without serializing input', () => {
  const input = sources();
  const secret = 'NEVER_SERIALIZE_THIS_SECRET';
  const cycle = {}; cycle.self = cycle;
  for (const item of [input.opportunity, input.contact, input.sourceEvent]) {
    Object.assign(item, { apiKey: secret, authorization: secret, rawSnapshot: cycle, providerResult: { secret },
      toJSON() { throw new Error('must not invoke'); }, bookingId: secret, confirmedRevenue: 9000,
      recovered: true, outcome: 'booking_confirmed', consent: true, dispatchStatus: 'completed', notes: [secret] });
    Object.defineProperty(item, 'token', { enumerable: true, get() { throw new Error('must not read unknown keys'); } });
  }
  input.opportunity.metadata = { notes: secret, transcript: secret, apiKey: secret };
  const output = projectRecoveryInquiry(input);
  const json = JSON.stringify(output);
  assert.equal(json.includes(secret), false);
  assert.deepEqual(Object.keys(output), ['id', 'tenantId', 'customerName', 'contact', 'subject', 'summary', 'source', 'receivedAt']);
  assert.deepEqual(Object.keys(output.contact), ['email', 'phone']);
  const proto = JSON.parse('{"__proto__":{"tenantId":"tenant_b"},"constructor":{"token":"hidden"}}');
  Object.assign(input.opportunity, { poison: proto });
  assert.deepEqual(projectRecoveryInquiry(input), output);
});

test('does not execute accessors on allowed fields or coerce objects to strings', () => {
  const input = sources();
  Object.defineProperty(input.contact, 'name', { enumerable: true, get() { throw new Error('secret'); } });
  fail(input, 'source_accessor_forbidden');
  const objectText = sources(); objectText.contact.name = { toString() { throw new Error('secret'); } };
  fail(objectText, 'invalid_contact_name');
});

test('excludes explicit synthetic markers and never classifies unmarked history as real', () => {
  for (const key of ['opportunity', 'sourceEvent', 'contact']) {
    for (const marker of [{ synthetic: true }, { synthetic: false, metadata: { synthetic: true } }, { synthetic: true, metadata: { synthetic: false } }]) {
      const input = sources(); Object.assign(input[key], marker); fail(input, 'source_synthetic_excluded');
    }
  }
  const unmarked = projectRecoveryInquiry(sources());
  assert.equal('synthetic' in unmarked, false); assert.equal('verifiedReal' in unmarked, false);
  const input = sources(); input.opportunity.metadata = { synthetic: 'false' };
  fail(input, 'invalid_synthetic_marker');
});

test('validates text bounds without silently truncating or accepting control data', () => {
  for (const [target, key, bad, code] of [
    ['contact', 'name', 'a'.repeat(201), 'invalid_contact_name'],
    ['contact', 'email', 'a'.repeat(321), 'invalid_contact_email'],
    ['contact', 'phone', 'a'.repeat(81), 'invalid_contact_phone'],
    ['contact', 'email', null, 'invalid_contact_email'],
    ['contact', 'phone', 15550100101, 'invalid_contact_phone'],
    ['opportunity', 'serviceType', 'a'.repeat(301), 'invalid_service_type'],
    ['opportunity', 'serviceType', 'foo\u007fbar', 'invalid_service_type'],
    ['opportunity', 'contactKey', 'tenant_a:' + 'a'.repeat(510), 'invalid_contact_key'],
  ]) {
    const input = sources(); input[target][key] = bad; fail(input, code);
  }
  const input = sources(); delete input.contact.name;
  input.contact.firstName = 'a'.repeat(200); input.contact.lastName = 'b';
  fail(input, 'invalid_contact_name');
});

test('strictly validates source event timestamps and preserves authoritative instants', () => {
  for (const bad of [undefined, null, '', 'yesterday', '2026-10-12', '2026-02-30T00:00:00Z', '2026-13-01T00:00:00Z', '2026-10-12T24:00:00Z', '2026-10-12T09:00:00+99:00', '2026-10-12T09:00:00', '2026-10-12T09:00:00ZSECRET', Infinity, -1, 1.5, {}]) {
    const input = sources(); input.sourceEvent.occurredAt = bad; fail(input, 'invalid_source_time');
  }
  for (const value of [Date.parse(T0), '2026-10-12T10:00:00+01:00', '2026-10-12T09:00:00Z']) {
    const input = sources(); input.sourceEvent.occurredAt = value;
    assert.equal(projectRecoveryInquiry(input).receivedAt, T0);
  }
});

test('creates only a local workflow plan, regardless of source status or alleged booking/revenue', () => {
  const input = sources();
  Object.assign(input.opportunity, { status: 'closed', outcome: 'booking_confirmed', recovered: true, assigneeId: 'secret', notes: ['secret'] });
  const plan = planInquirySourceRefresh({ ...input, refreshedAt: T2 });
  assert.equal(plan.kind, 'create'); assert.equal(plan.expectedVersion, null);
  assert.equal(plan.inquiry.status, 'new'); assert.equal(plan.inquiry.assigneeId, null);
  assert.equal(plan.inquiry.version, 1); assert.deepEqual(plan.inquiry.notes, []);
  assert.deepEqual(plan.audit, { tenantId: 'tenant_a', inquiryId: 'opp_a', action: 'inquiry.source_created', fields: [...SOURCE_FIELDS], previousVersion: null, version: 1, occurredAt: T2 });
});

test('source refresh changes allowed columns while preserving human status, assignment and notes', () => {
  const input = sources(); const before = existing();
  input.contact.name = 'Updated synthetic name'; input.contact.phone = '+15550100102';
  input.opportunity.serviceType = 'Updated service'; input.opportunity.status = 'closed';
  const plan = planInquirySourceRefresh({ ...input, existing: before, expectedVersion: 7, refreshedAt: T2 });
  assert.equal(plan.kind, 'refresh'); assert.equal(plan.expectedVersion, 7);
  assert.equal(plan.inquiry.version, 8); assert.equal(plan.inquiry.updatedAt, T2);
  assert.equal(plan.inquiry.status, 'waiting'); assert.equal(plan.inquiry.assigneeId, 'member_a');
  assert.deepEqual(plan.inquiry.notes, before.notes); assert.notEqual(plan.inquiry.notes[0], before.notes[0]);
  assert.equal(plan.inquiry.customerName, 'Updated synthetic name');
  assert.deepEqual(plan.audit.fields, ['customerName', 'contact.phone', 'subject']);
  assert.equal(plan.audit.action, 'inquiry.source_refreshed');
  assert.equal(JSON.stringify(plan.audit).includes('Updated synthetic name'), false);
  assert.equal(JSON.stringify(plan.audit).includes('Synthetic internal note'), false);
});

test('unchanged refresh has no audit or new version, and preserves equivalent date spelling', () => {
  const before = existing(); before.receivedAt = '2026-10-12T10:00:00+01:00';
  const plan = planInquirySourceRefresh({ ...sources(), existing: before, expectedVersion: 7, refreshedAt: T2 });
  assert.equal(plan.kind, 'unchanged'); assert.equal(plan.audit, null);
  assert.deepEqual(plan.inquiry, before);
});

test('does not erase an existing summary when this mapper has no authoritative replacement', () => {
  const before = existing(); before.summary = 'Previously approved synthetic summary';
  const unchanged = planInquirySourceRefresh({ ...sources(), existing: before, expectedVersion: 7, refreshedAt: T2 });
  assert.equal(unchanged.kind, 'unchanged');
  assert.equal(unchanged.inquiry.summary, before.summary);
  const input = sources(); input.contact.name = 'Changed';
  const updated = planInquirySourceRefresh({ ...input, existing: before, expectedVersion: 7, refreshedAt: T2 });
  assert.equal(updated.inquiry.summary, before.summary);
  assert.deepEqual(updated.audit.fields, ['customerName']);
});

test('source-only plan strips arbitrary existing payload fields and never mutates inputs', () => {
  const input = sources(); const before = existing();
  before.rawSnapshot = { apiKey: 'SECRET' }; before.notes[0].privateToken = 'SECRET';
  const copies = structuredClone({ input, before });
  deepFreeze(input); deepFreeze(before);
  const plan = planInquirySourceRefresh({ ...input, existing: before, expectedVersion: 7, refreshedAt: T2 });
  assert.deepEqual({ input, before }, copies);
  assert.equal(JSON.stringify(plan).includes('SECRET'), false);
  plan.inquiry.notes[0].text = 'Changed only output';
  assert.equal(before.notes[0].text, 'Synthetic internal note');
});

test('rejects wrong existing tenant/object/child links and malformed workflow', () => {
  for (const [change, code] of [
    [row => { row.tenantId = 'tenant_b'; }, 'existing_tenant_mismatch'],
    [row => { row.id = 'opp_other'; }, 'existing_inquiry_mismatch'],
    [row => { row.status = 'booked'; }, 'invalid_existing_workflow'],
    [row => { row.assigneeId = 'bad/id'; }, 'invalid_existing_workflow'],
    [row => { row.version = 0; }, 'invalid_existing_workflow'],
    [row => { row.notes[0].tenantId = 'tenant_b'; }, 'existing_note_link_mismatch'],
    [row => { row.notes[0].inquiryId = 'opp_other'; }, 'existing_note_link_mismatch'],
    [row => { row.notes[0].authorId = 'bad/id'; }, 'invalid_existing_notes'],
    [row => { row.notes.push({ ...row.notes[0] }); }, 'invalid_existing_notes'],
    [row => { row.notes[0].text = ''; }, 'invalid_existing_notes'],
    [row => { row.notes[0].createdAt = 'invalid'; }, 'invalid_existing_notes'],
    [row => { row.contact = []; }, 'invalid_existing_source'],
    [row => { row.updatedAt = 'invalid'; }, 'invalid_existing_time'],
  ]) {
    const before = existing(); change(before);
    fail({ ...sources(), existing: before, expectedVersion: 7, refreshedAt: T2 }, code, planInquirySourceRefresh);
  }
});

test('requires exact expected version, a valid clock, and safe version increments', () => {
  for (const version of [undefined, null, 6, '7', 8]) {
    fail({ ...sources(), existing: existing(), expectedVersion: version, refreshedAt: T2 }, 'version_conflict', planInquirySourceRefresh);
  }
  fail({ ...sources(), expectedVersion: 1, refreshedAt: T2 }, 'version_conflict', planInquirySourceRefresh);
  fail({ ...sources(), existing: existing(), expectedVersion: 7, refreshedAt: T0 }, 'refresh_time_precedes_record', planInquirySourceRefresh);
  fail({ ...sources() }, 'invalid_refresh_time', planInquirySourceRefresh);
  const input = sources(); input.contact.name = 'Changed';
  const before = existing(); before.version = Number.MAX_SAFE_INTEGER;
  fail({ ...input, existing: before, expectedVersion: before.version, refreshedAt: T2 }, 'version_exhausted', planInquirySourceRefresh);
  assert.equal(planInquirySourceRefresh({ ...sources(), existing: before, expectedVersion: before.version, refreshedAt: T2 }).kind, 'unchanged');
});

test('missing, pruned or synthetic source never yields a delete or an automatic close plan', () => {
  for (const [change, code] of [
    [input => { input.sourceEvent = null; }, 'source_event_required'],
    [input => { input.contact = null; }, 'contact_required'],
    [input => { input.opportunity.synthetic = true; }, 'source_synthetic_excluded'],
  ]) {
    const input = sources(); change(input);
    fail({ ...input, existing: existing(), expectedVersion: 7, refreshedAt: T2 }, code, planInquirySourceRefresh);
  }
});

test('module remains standalone and inactive with no runtime or network imports', async () => {
  const source = await readFile(new URL('../server/source-projection.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /^\s*import\s/m);
  assert.doesNotMatch(source, /\b(?:fetch|listen|connect|writeFile|createServer|setInterval)\s*\(/);
});
