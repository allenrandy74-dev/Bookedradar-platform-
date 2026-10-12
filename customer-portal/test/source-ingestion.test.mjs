import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createPostgresRecoverySourceReader, SourceIngestionError } from '../server/source-reader.mjs';
import { createPostgresSourceImporter } from '../server/source-importer.mjs';
import { projectRecoveryInquiry } from '../server/source-projection.mjs';
import { createSourceVisibilityPredicate, planSourceVisibility, SourceVisibilityError, SOURCE_REJECTION_CODES } from '../server/source-visibility.mjs';

const tenantId = 'tenant_a';
const T0 = '2026-10-12T08:00:00.000Z';
const T1 = '2026-10-12T09:00:00.000Z';
const T2 = '2026-10-12T10:00:00.000Z';
function fixtures() {
  // Entirely fabricated. Unmarked copies intentionally exercise structurally
  // eligible records; the true-marker exclusion is never disabled for tests.
  return {
    tenantId,
    opportunity: { id: 'opp_a', tenantId, contactKey: `${tenantId}:crm_a`, sourceEventId: 'evt_a', type: 'phone_lead', source: 'phone', serviceType: 'Synthetic inspection' },
    contact: { tenantId, contactKey: `${tenantId}:crm_a`, name: 'Synthetic Customer', email: 'fixture@example.test', phone: '+15550100101' },
    sourceEvent: { id: 'evt_a', tenantId, type: 'phone_lead', occurredAt: T0, contact: { externalId: 'crm_a' } },
  };
}
function harness({ existing = false } = {}) {
  const f = fixtures();
  const state = {
    opportunityRows: [{ tenant_id: tenantId, id: 'opp_a', contact_key: f.opportunity.contactKey, payload: f.opportunity }],
    contactRows: [{ tenant_id: tenantId, id: f.contact.contactKey, payload: f.contact }],
    eventRows: [{ tenant_id: tenantId, id: 'evt_a', opportunity_id: null, contact_key: null, occurred_at: T0, payload: f.sourceEvent }],
    events: [], actions: [], attribution: [], ids: ['opp_a'], active: true,
    current: null, link: null, visibility: null, observedAt: T2, fail: null, commitCommand: 'COMMIT', insertCount: 1, updateCount: 1, visibilityUpdateCount: 1,
  };
  if (existing) {
    const source = projectRecoveryInquiry(f);
    state.current = { id: 'opp_a', tenant_id: tenantId, customer_name: source.customerName, contact_email: source.contact.email,
      contact_phone: source.contact.phone, subject: source.subject, source: source.source, received_at: source.receivedAt,
      summary: 'Keep synthetic summary', status: 'waiting', assignee_id: 'member_a', version: '7', updated_at: T1,
      notes: [{ id: 'note_a', tenant_id: tenantId, inquiry_id: 'opp_a', author_id: 'member_a', text: 'Keep synthetic note', created_at: T1 }] };
    state.link = { tenant_id: tenantId, inquiry_id: 'opp_a', source_kind: 'recovery', source_opportunity_id: 'opp_a', source_contact_key: f.contact.contactKey,
      source_event_id: 'evt_a', source_fingerprint: 'a'.repeat(64), first_imported_at: T1, last_observed_at: T1 };
    state.visibility = { tenant_id: tenantId, inquiry_id: 'opp_a', state: 'active', revision: '1', source_fingerprint: 'a'.repeat(64), checked_at: T1, valid_until: '2026-10-12T09:01:00.000Z', reason_code: null };
  }
  const calls = []; const releases = []; let connects = 0;
  const rows = values => ({ rows: structuredClone(values), rowCount: values.length });
  const db = {
    async query(sql, values = []) {
      calls.push({ sql, values: structuredClone(values) });
      const failure = state.fail?.(sql, values);
      if (failure) throw failure instanceof Error ? failure : new Error('PRIVATE_PARAMETER_DB_DETAIL');
      if (sql === 'COMMIT') return { command: state.commitCommand, rows: [] };
      if (/^BEGIN|^SET |^ROLLBACK|pg_advisory_xact_lock/.test(sql)) return rows([]);
      if (/clock_timestamp/.test(sql)) return rows([{ observed_at: state.observedAt }]);
      if (/SELECT id FROM .*\.tenants/.test(sql)) return rows(state.active ? [{ id: tenantId }] : []);
      if (/SELECT r.opportunity_id AS id FROM/.test(sql)) return rows(state.ids.map(id => ({ id })));
      if (/FROM .*\.recovery_opportunities r/.test(sql)) return rows(state.opportunityRows);
      if (/FROM .*\.recovery_contacts r/.test(sql)) return rows(state.contactRows);
      if (/FROM .*\.recovery_events r/.test(sql)) return rows(/r.event_id=\$2/.test(sql) ? state.eventRows : state.events);
      if (/FROM .*\.recovery_actions r/.test(sql)) return rows(state.actions);
      if (/FROM .*\.recovery_attribution r/.test(sql)) return rows(state.attribution);
      if (/SELECT id FROM .*\.inquiries/.test(sql)) return rows(state.current ? [{ id: 'opp_a' }] : []);
      if (/FROM .*\.inquiries i WHERE/.test(sql)) return rows(state.current ? [state.current] : []);
      if (/SELECT tenant_id,inquiry_id,source_kind/.test(sql)) return rows(state.link ? [state.link] : []);
      if (/SELECT tenant_id,inquiry_id,state,revision/.test(sql)) return rows(state.visibility ? [state.visibility] : []);
      if (/INSERT INTO .*\.inquiries/.test(sql)) return { rows: [], rowCount: state.insertCount };
      if (/UPDATE .*\.inquiries/.test(sql)) return { rows: [], rowCount: state.updateCount };
      if (/UPDATE .*\.source_visibility SET/.test(sql)) return { rows: [], rowCount: state.visibilityUpdateCount };
      if (/INSERT INTO|UPDATE .*\.source_(?:links|visibility)/.test(sql)) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected test query: ${sql}`);
    },
    release(broken) { releases.push(broken); if (state.releaseThrows) throw new Error('PRIVATE_RELEASE_DETAILS'); },
  };
  const pool = { async connect() { connects++; return db; } };
  const config = { pool, tenantId, enabled: true };
  return { state, calls, releases, config, get connects() { return connects; },
    importer: () => createPostgresSourceImporter(config), reader: () => createPostgresRecoverySourceReader(config) };
}
const code = expected => error => error.code === expected && error.message === expected && !String(error).includes('PRIVATE');
const importOne = h => h.importer().importInquiry({ opportunityId: 'opp_a', expectedVersion: h.state.current ? Number(h.state.current.version) : null });

test('inactive construction, explicit scope, schema allowlists and top-level pool contract', () => {
  const h = harness();
  assert.throws(() => createPostgresSourceImporter({ ...h.config, enabled: false }), code('source_ingestion_disabled'));
  assert.throws(() => createPostgresSourceImporter({ pool: h.config.pool, tenantId }), code('source_ingestion_disabled'));
  for (const invalid of ['', null, 'tenant/escape', 'x'.repeat(129)]) assert.throws(() => createPostgresSourceImporter({ ...h.config, tenantId: invalid }), code('invalid_tenant'));
  for (const sourceSchema of ['public', 'bookedradar;DROP TABLE x', 'bookedradar_staging']) assert.throws(() => createPostgresSourceImporter({ ...h.config, sourceSchema }), code('invalid_source_schema'));
  for (const portalSchema of ['public', 'bookedradar_portal_staging', 'bookedradar_portal;DROP TABLE x']) assert.throws(() => createPostgresSourceImporter({ ...h.config, portalSchema }), code('invalid_portal_schema'));
  assert.throws(() => createPostgresSourceImporter({ ...h.config, pool: { ...h.config.pool, requiresOuterCommit: true } }), code('top_level_source_pool_required'));
  createPostgresSourceImporter({ ...h.config, sourceSchema: 'bookedradar_test_abcdef123456', portalSchema: 'bookedradar_portal_test_abcdef123456' });
  assert.equal(h.connects, 0);
});

test('source read is bounded and tenant scoped after the actual READ COMMITTED fence', async () => {
  const h = harness(); const result = await h.reader().readInquiry({ opportunityId: 'opp_a' });
  assert.equal(result.inquiry.customerName, 'Synthetic Customer'); assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.binding, { sourceKind: 'recovery', opportunityId: 'opp_a', contactKey: 'tenant_a:crm_a', sourceEventId: 'evt_a' });
  assert.equal(h.calls[0].sql, 'BEGIN ISOLATION LEVEL READ COMMITTED');
  const lock = h.calls.findIndex(c => c.sql.includes('pg_advisory_xact_lock'));
  assert.equal(h.calls[lock].sql, "SELECT pg_advisory_xact_lock(hashtext('br_recovery'),hashtext($1))");
  assert.deepEqual(h.calls[lock].values, [tenantId]);
  const reads = h.calls.filter(c => c.sql.includes('FROM "bookedradar".recovery_'));
  assert.equal(reads.length, 6);
  for (const c of reads) {
    assert.ok(h.calls.indexOf(c) > lock); assert.match(c.sql, /r.tenant_id=\$1/); assert.equal(c.values[0], tenantId);
    assert.match(c.sql, /LIMIT (1|2|\$3)/); assert.doesNotMatch(c.sql, /FOR SHARE|FOR UPDATE/);
    assert.match(c.sql, /octet_length/); assert.match(c.sql, /32768/);
    assert.doesNotMatch(c.sql, /SELECT \*|SELECT r\.payload|snapshot|readRecovery|transcript|confirmedRevenue|estimatedValue|consent/);
  }
  assert.deepEqual(reads.filter(c => c.sql.includes('LIMIT $3')).map(c => c.values[2]), [101, 101]);
  assert.equal(h.calls.at(-1).sql, 'COMMIT'); assert.deepEqual(h.releases, [false]);
});

test('page bounds, keyset continuation and malformed IDs fail without reading another tenant', async () => {
  const h = harness(); h.state.ids = ['opp_a', 'opp_b', 'opp_c'];
  assert.deepEqual(await h.importer().listOpportunityIds({ limit: 2 }), { opportunityIds: ['opp_a', 'opp_b'], nextAfterId: 'opp_b' });
  assert.deepEqual(h.calls.find(c => c.sql.includes('SELECT r.opportunity_id AS id FROM')).values, [tenantId, null, 3]);
  for (const limit of [0, 26, 1.5, '1', Infinity]) await assert.rejects(h.reader().listOpportunityIds({ limit }), code('invalid_source_limit'));
  await assert.rejects(h.reader().listOpportunityIds({ afterId: '' }), code('invalid_source_cursor'));
  h.state.ids = ['../oops']; await assert.rejects(h.reader().listOpportunityIds(), code('invalid_source_page'));
});

test('missing and conflicting source columns fail closed with stable, value-free errors', async () => {
  const cases = [
    [s => s.opportunityRows = [], 'source_opportunity_missing'],
    [s => s.contactRows = [], 'source_contact_missing'],
    [s => s.eventRows = [], 'source_event_missing'],
    [s => s.opportunityRows[0].tenant_id = 'tenant_b', 'source_tenant_mismatch'],
    [s => s.contactRows[0].payload.tenantId = null, 'source_tenant_mismatch'],
    [s => s.eventRows[0].tenant_id = null, 'source_tenant_mismatch'],
    [s => s.opportunityRows[0].payload.id = 'other', 'source_column_id_mismatch'],
    [s => s.contactRows[0].payload.contactKey = 'tenant_a:other', 'source_column_id_mismatch'],
    [s => s.eventRows[0].payload.id = 'other', 'source_column_id_mismatch'],
    [s => s.opportunityRows[0].contact_key = 'tenant_a:other', 'source_column_link_mismatch'],
    [s => s.eventRows[0].contact_key = 'tenant_a:other', 'source_column_link_mismatch'],
    [s => s.eventRows[0].opportunity_id = 'opp_b', 'source_column_link_mismatch'],
    [s => s.eventRows[0].occurred_at = T1, 'source_column_time_mismatch'],
    [s => s.contactRows[0].payload = null, 'invalid_source_payload'],
    [s => s.opportunityRows[0].payload = ['bad'], 'invalid_source_payload'],
  ];
  for (const [mutate, expected] of cases) {
    const h = harness(); mutate(h.state); await assert.rejects(importOne(h), code(expected));
    assert.equal(h.calls.at(-1).sql, 'ROLLBACK'); assert.ok(!h.calls.some(c => /^INSERT INTO|^UPDATE /.test(c.sql)));
  }
});

test('only absent legacy event tenant may be established from a matching SQL column', async () => {
  const h = harness(); delete h.state.eventRows[0].payload.tenantId;
  assert.equal((await h.reader().readInquiry({ opportunityId: 'opp_a' })).source.sourceEvent.tenantId, tenantId);
  for (const owner of ['', null, 'tenant_b', false]) {
    h.state.eventRows[0].payload.tenantId = owner;
    await assert.rejects(importOne(h), code('source_tenant_mismatch'));
  }
  const other = harness(); delete other.state.contactRows[0].payload.tenantId;
  await assert.rejects(importOne(other), code('source_tenant_mismatch'));
});

test('synthetic=true cannot be weakened on the triple or bounded direct lineage', async () => {
  for (const collection of ['opportunityRows', 'contactRows', 'eventRows']) {
    const h = harness(); h.state[collection][0].payload.synthetic = false; h.state[collection][0].payload.metadata = { synthetic: true };
    await assert.rejects(importOne(h), code('source_synthetic_excluded'));
  }
  for (const collection of ['events', 'actions', 'attribution']) {
    const h = harness();
    const row = { tenant_id: tenantId, id: collection === 'attribution' ? 'opp_a' : 'lineage_a', opportunity_id: 'opp_a', contact_key: null,
      payload: { tenantId, id: 'lineage_a', opportunityId: 'opp_a', metadata: { synthetic: true } } };
    h.state[collection] = [row]; await assert.rejects(importOne(h), code('source_synthetic_excluded'));
    row.payload.metadata.synthetic = 'true'; await assert.rejects(importOne(h), code('invalid_synthetic_marker'));
    row.payload.metadata.synthetic = false; row.payload.opportunityId = 'opp_b';
    await assert.rejects(importOne(h), error => ['source_column_link_mismatch', 'source_column_id_mismatch'].includes(error.code));
  }
});

test('direct lineage contact links must agree with the bound contact, preserving raw event-key support', async () => {
  for (const collection of ['events', 'actions', 'attribution']) {
    const h = harness();
    const row = { tenant_id: tenantId, id: collection === 'attribution' ? 'opp_a' : 'lineage_a', opportunity_id: 'opp_a', contact_key: 'tenant_b:foreign',
      payload: { tenantId, id: 'lineage_a', opportunityId: 'opp_a', contactKey: 'tenant_b:foreign' } };
    h.state[collection] = [row]; await assert.rejects(importOne(h), code('source_lineage_contact_mismatch'));
    row.contact_key = 'tenant_a:other'; row.payload.contactKey = row.contact_key;
    await assert.rejects(importOne(h), code('source_lineage_contact_mismatch'));
    row.contact_key = 'tenant_a:crm_a'; row.payload.contactKey = row.contact_key;
    assert.equal((await importOne(h)).kind, 'create');
  }
  const event = harness(); event.state.events = [{ tenant_id: tenantId, id: 'lineage_a', opportunity_id: 'opp_a', contact_key: 'crm_a',
    payload: { tenantId, id: 'lineage_a', opportunityId: 'opp_a', contactKey: 'crm_a' } }];
  assert.equal((await importOne(event)).kind, 'create');
});

test('lineage overflow fails rather than silently ignoring excess eligibility records', async () => {
  for (const collection of ['events', 'actions']) {
    const h = harness(); h.state[collection] = Array.from({ length: 101 }, () => ({}));
    await assert.rejects(importOne(h), code('source_lineage_limit_exceeded'));
  }
  const h = harness(); h.state.attribution = [{}, {}]; await assert.rejects(importOne(h), code('source_lineage_link_mismatch'));
});

test('create performs insert-only source projection, durable binding and separate service audit', async () => {
  const h = harness(); const result = await importOne(h);
  assert.deepEqual(result, { kind: 'create', inquiryId: 'opp_a', version: 1 });
  const inserted = h.calls.find(c => /INSERT INTO .*\.inquiries/.test(c.sql));
  assert.match(inserted.sql, /ON CONFLICT \(tenant_id,id\) DO NOTHING/);
  assert.match(inserted.sql, /'new',NULL,1/);
  const link = h.calls.find(c => /INSERT INTO .*\.source_links/.test(c.sql));
  assert.deepEqual(link.values.slice(0, 4), [tenantId, 'opp_a', 'tenant_a:crm_a', 'evt_a']); assert.match(link.values[4], /^[a-f0-9]{64}$/);
  const audit = h.calls.find(c => /INSERT INTO .*\.source_ingestion_audit/.test(c.sql));
  assert.match(audit.sql, /'recovery_importer_v1'/); assert.equal(audit.values[3], 'inquiry.source_created');
  assert.equal(audit.values[5], null); assert.equal(audit.values[6], 1);
  assert.doesNotMatch(JSON.stringify(audit.values), /Customer|fixture@example|155501|crm_a|evt_a/);
  assert.ok(!h.calls.some(c => /INSERT INTO .*\.audit_events|(?:INSERT INTO|UPDATE|DELETE FROM) "bookedradar"/.test(c.sql)));
});

test('refresh holds parent before a fresh notes read, uses post-lock time and updates only source columns', async () => {
  const h = harness({ existing: true }); h.state.contactRows[0].payload.name = 'Updated Synthetic Customer';
  const previous = structuredClone(h.state.current);
  assert.deepEqual(await importOne(h), { kind: 'refresh', inquiryId: 'opp_a', version: 8 });
  const parentLock = h.calls.findIndex(c => /SELECT id FROM .*\.inquiries/.test(c.sql));
  const parentRead = h.calls.findIndex(c => /FROM .*\.inquiries i WHERE/.test(c.sql));
  const linkLock = h.calls.findIndex(c => /SELECT tenant_id,inquiry_id,source_kind/.test(c.sql));
  const clock = h.calls.findIndex(c => c.sql === 'SELECT clock_timestamp() AS observed_at');
  assert.ok(parentLock < parentRead && parentRead < linkLock && linkLock < clock);
  const update = h.calls.find(c => /UPDATE .*\.inquiries/.test(c.sql));
  assert.doesNotMatch(update.sql, /SET .*summary=|status=|assignee_id=|notes=/); assert.match(update.sql, /AND version=\$11/);
  assert.equal(update.values[8], T2); assert.equal(update.values[9], 8); assert.equal(update.values[10], 7);
  assert.deepEqual(h.state.current, previous); assert.ok(!h.calls.some(c => /(?:INSERT INTO|UPDATE|DELETE FROM) .*\.notes/.test(c.sql)));
  const audit = h.calls.find(c => /INSERT INTO .*\.source_ingestion_audit/.test(c.sql));
  assert.deepEqual(audit.values.slice(3, 7), ['inquiry.source_refreshed', ['customerName'], 7, 8]);
});

test('identical projection is a no-op for inquiry version, update time and audit', async () => {
  const h = harness({ existing: true });
  assert.deepEqual(await importOne(h), { kind: 'unchanged', inquiryId: 'opp_a', version: 7 });
  assert.ok(!h.calls.some(c => /UPDATE .*\.inquiries|INSERT INTO .*\.source_ingestion_audit/.test(c.sql)));
  assert.equal(h.calls.filter(c => /UPDATE .*\.source_links/.test(c.sql)).length, 1);
});

test('expected version and immutable lineage reject takeover, rebind, and lost update', async () => {
  for (const key of ['source_kind', 'source_opportunity_id', 'source_contact_key', 'source_event_id']) {
    const h = harness({ existing: true }); h.state.link[key] = 'different';
    assert.deepEqual(await importOne(h), { kind: 'quarantined', inquiryId: 'opp_a', version: 8, reasonCode: 'source_binding_conflict' });
  }
  const missing = harness({ existing: true }); missing.state.link = null;
  await assert.rejects(importOne(missing), code('source_binding_missing'));
  const stale = harness({ existing: true });
  await assert.rejects(stale.importer().importInquiry({ opportunityId: 'opp_a', expectedVersion: 6 }), code('version_conflict'));
  await assert.rejects(stale.importer().importInquiry({ opportunityId: 'opp_a', expectedVersion: null }), code('version_conflict'));
  const fresh = harness();
  for (const expectedVersion of [undefined, 0, '1', -1, Number.MAX_SAFE_INTEGER + 1]) await assert.rejects(fresh.importer().importInquiry({ opportunityId: 'opp_a', expectedVersion }), code('expected_version_required'));
  assert.equal(fresh.connects, 0);
  const conflict = harness({ existing: true }); conflict.state.contactRows[0].payload.name = 'Updated'; conflict.state.updateCount = 0;
  await assert.rejects(importOne(conflict), code('version_conflict'));
  const collision = harness(); collision.state.insertCount = 0;
  await assert.rejects(importOne(collision), code('portal_insert_conflict'));
});

test('disabled tenant, regressed observation time and failed audit roll back', async () => {
  const inactive = harness(); inactive.state.active = false;
  await assert.rejects(importOne(inactive), code('portal_tenant_inactive'));
  assert.ok(!inactive.calls.some(c => /recovery_opportunities/.test(c.sql)));
  const time = harness({ existing: true }); time.state.observedAt = T0;
  await assert.rejects(importOne(time), code('source_observation_time_regressed'));
  const audit = harness(); audit.state.fail = sql => /INSERT INTO .*\.source_ingestion_audit/.test(sql);
  await assert.rejects(importOne(audit), code('source_database_error'));
  assert.equal(audit.calls.at(-1).sql, 'ROLLBACK'); assert.ok(!audit.calls.some(c => c.sql === 'COMMIT'));
});

test('uncertain commit never retries and destroys the connection; escaped scope is closed', async () => {
  const h = harness(); h.state.fail = sql => sql === 'COMMIT';
  await assert.rejects(importOne(h), code('source_commit_uncertain'));
  assert.deepEqual(h.releases, [true]); assert.equal(h.connects, 1);
  const aborted = harness(); aborted.state.commitCommand = 'ROLLBACK';
  await assert.rejects(importOne(aborted), code('source_transaction_not_committed')); assert.deepEqual(aborted.releases, [true]);
  const closed = harness(); let escaped;
  await closed.reader().withFencedSource(tx => { escaped = tx; });
  assert.throws(() => escaped.readInquiry('opp_a'), code('source_transaction_closed'));
  await assert.rejects(escaped.listOpportunityIds(), code('source_transaction_closed'));
});

test('release failures never mask uncertain commit state or suggest safe replay', async () => {
  const committed = harness(); committed.state.releaseThrows = true;
  await assert.rejects(importOne(committed), code('source_commit_uncertain'));
  assert.equal(committed.calls.filter(c => c.sql === 'COMMIT').length, 1);
  const unknown = harness(); unknown.state.releaseThrows = true; unknown.state.fail = sql => sql === 'COMMIT';
  await assert.rejects(importOne(unknown), code('source_commit_uncertain')); assert.deepEqual(unknown.releases, [true]);
  const invalid = harness(); invalid.state.releaseThrows = true; invalid.state.eventRows = [];
  await assert.rejects(importOne(invalid), code('source_event_missing'));
});

test('connection and spoofed projection errors cannot leak database diagnostics', async () => {
  const failedPool = { async connect() { throw new Error('PRIVATE_CONNECTION_DETAILS'); } };
  const failed = createPostgresSourceImporter({ pool: failedPool, tenantId, enabled: true });
  await assert.rejects(failed.importInquiry({ opportunityId: 'opp_a', expectedVersion: null }), code('source_database_error'));
  const h = harness();
  await assert.rejects(h.reader().withFencedSource(() => { const error = new Error('PRIVATE_QUERY_DETAILS'); error.name = 'SourceProjectionError'; throw error; }), code('source_database_error'));
  assert.equal(h.calls.at(-1).sql, 'ROLLBACK');
});

test('new modules have no runtime import, automatic migration, CLI or source write wiring', async () => {
  const base = new URL('../', import.meta.url);
  const reader = await readFile(new URL('server/source-reader.mjs', base), 'utf8');
  const importer = await readFile(new URL('server/source-importer.mjs', base), 'utf8');
  for (const source of [reader, importer]) assert.doesNotMatch(source, /process\.env|import\(.pg.|new Pool|\.listen\(|setInterval\(|readFile\(|fetch\(/);
  for (const filename of await readdir(new URL('server/', base))) {
    if (!filename.endsWith('.mjs') || filename.startsWith('source-')) continue;
    assert.doesNotMatch(await readFile(new URL(`server/${filename}`, base), 'utf8'), /(?:from|import).*source-(?:reader|importer)/);
  }
  for (const filename of ['app.mjs', 'staging-app.mjs', 'preview.mjs']) assert.doesNotMatch(await readFile(new URL(filename, base), 'utf8'), /source-(?:reader|importer)/);
  const ddl = await readFile(new URL('server/schema.source-ingestion.sql', base), 'utf8');
  assert.doesNotMatch(ddl, /^\s*(?:GRANT|ALTER TABLE|CREATE ROLE|DROP|INSERT INTO|UPDATE|DELETE FROM)\b/im);
  assert.match(ddl, /CREATE TABLE bookedradar_portal.source_links/); assert.match(ddl, /CREATE TABLE bookedradar_portal.source_ingestion_audit/);
  assert.equal(new SourceIngestionError('test_code').message, 'test_code');
});

test('visibility predicate is a schema-safe same-statement linked freshness gate', () => {
  const sql = createSourceVisibilityPredicate({ schema: 'bookedradar_portal', inquiryAlias: 'i' });
  for (const pattern of [/source_links/, /source_visibility/, /sl.tenant_id=i.tenant_id/, /sl.inquiry_id=i.id/,
    /sv.state='active'/, /sv.reason_code IS NULL/, /sv.source_fingerprint=sl.source_fingerprint/,
    /sv.checked_at<=clock_timestamp\(\)/, /sv.valid_until>clock_timestamp\(\)/, /INTERVAL '60 seconds'/]) assert.match(sql, pattern);
  assert.doesNotMatch(sql, /reason_code AS|contact_key|source_event_id|CURRENT_TIMESTAMP/);
  for (const schema of ['public', 'bookedradar_portal_staging', 'bookedradar_portal;--']) assert.throws(() => createSourceVisibilityPredicate({ schema }), error => error instanceof SourceVisibilityError);
  for (const inquiryAlias of ['i;--', 'i.id', 'I', '']) assert.throws(() => createSourceVisibilityPredicate({ schema: 'bookedradar_portal', inquiryAlias }), error => error instanceof SourceVisibilityError);
});

test('visibility plans enforce bounded leases, closed reasons, revision CAS metadata and overflow', () => {
  const args = { state: 'active', sourceFingerprint: 'a'.repeat(64), checkedAt: T2 };
  const first = planSourceVisibility(args);
  assert.equal(first.value.validUntil, '2026-10-12T10:01:00.000Z'); assert.equal(first.value.revision, 1);
  assert.equal(first.audit.action, 'source.verified'); assert.equal(first.audit.previousRevision, null);
  for (const leaseMs of [0, 999, 60001, '1000', 1000.5]) assert.throws(() => planSourceVisibility({ ...args, leaseMs }), code('invalid_visibility_lease'));
  const hidden = planSourceVisibility({ ...args, previous: first.value, state: 'quarantined', reasonCode: 'source_event_missing' });
  assert.equal(hidden.value.validUntil, null); assert.equal(hidden.value.revision, 2);
  assert.equal(hidden.audit.action, 'source.quarantined'); assert.equal(hidden.audit.previousRevision, 1);
  assert.equal(planSourceVisibility({ ...args, previous: hidden.value, state: 'quarantined', reasonCode: 'source_event_missing' }).kind, 'unchanged');
  const restored = planSourceVisibility({ ...args, previous: hidden.value }); assert.equal(restored.value.revision, 3);
  for (const reasonCode of ['source_database_error', 'PRIVATE_DATA', null]) assert.throws(() => planSourceVisibility({ ...args, state: 'quarantined', reasonCode }), code('invalid_visibility_reason'));
  assert.throws(() => planSourceVisibility({ ...args, previous: { ...first.value, revision: Number.MAX_SAFE_INTEGER } }), code('visibility_revision_exhausted'));
  assert.throws(() => planSourceVisibility({ ...args, previous: first.value, checkedAt: T1 }), code('visibility_time_regressed'));
});

test('known source failures quarantine bound rows, invalidate drafts and preserve workflow despite stale expected version', async () => {
  const h = harness({ existing: true }); h.state.eventRows = [];
  const before = structuredClone(h.state.current);
  const result = await h.importer().importInquiry({ opportunityId: 'opp_a', expectedVersion: 1 });
  assert.deepEqual(result, { kind: 'quarantined', inquiryId: 'opp_a', version: 8, reasonCode: 'source_event_missing' });
  const parent = h.calls.findIndex(c => /SELECT id FROM .*\.inquiries/.test(c.sql));
  const link = h.calls.findIndex(c => /SELECT tenant_id,inquiry_id,source_kind/.test(c.sql));
  const visibility = h.calls.findIndex(c => /SELECT tenant_id,inquiry_id,state,revision/.test(c.sql));
  const source = h.calls.findIndex(c => /FROM .*\.recovery_opportunities/.test(c.sql));
  assert.ok(parent < link && link < visibility && visibility < source);
  const version = h.calls.find(c => /UPDATE .*\.inquiries/.test(c.sql));
  assert.match(version.sql, /SET version=\$3,updated_at=\$4/); assert.deepEqual(version.values, [tenantId, 'opp_a', 8, T2, 7]);
  assert.deepEqual(h.state.current, before); assert.ok(!h.calls.some(c => /UPDATE .*\.source_links|INSERT INTO .*\.source_ingestion_audit|(?:INSERT INTO|UPDATE|DELETE FROM) .*\.notes/.test(c.sql)));
  const update = h.calls.find(c => /UPDATE .*\.source_visibility SET/.test(c.sql));
  assert.equal(update.values[2], 'quarantined'); assert.equal(update.values[3], 2); assert.equal(update.values[6], null);
  assert.equal(update.values[7], 'source_event_missing'); assert.equal(update.values[8], 1);
  const audit = h.calls.find(c => /INSERT INTO .*\.source_visibility_audit/.test(c.sql));
  assert.deepEqual(audit.values.slice(3), ['source.quarantined', 1, 2, 'active', 'quarantined', 'source_event_missing', T2, null, 7, 8]);
  assert.doesNotMatch(JSON.stringify(audit.values), /Customer|fixture@example|155501|crm_a|evt_a/);
  assert.equal(h.calls.at(-1).sql, 'COMMIT');
});

test('quarantine is idempotent and restoration requires fresh source plus original binding', async () => {
  const hidden = () => {
    const h = harness({ existing: true }); h.state.current.version = '8';
    h.state.visibility = { ...h.state.visibility, state: 'quarantined', revision: '2', checked_at: T2, valid_until: null, reason_code: 'source_event_missing' };
    return h;
  };
  const repeated = hidden(); repeated.state.eventRows = [];
  assert.equal((await importOne(repeated)).version, 8);
  assert.ok(!repeated.calls.some(c => /^INSERT INTO|^UPDATE /.test(c.sql)));
  const restore = hidden();
  assert.deepEqual(await importOne(restore), { kind: 'restored', inquiryId: 'opp_a', version: 9 });
  assert.equal(restore.calls.filter(c => /UPDATE .*\.inquiries/.test(c.sql)).length, 1);
  assert.ok(!restore.calls.some(c => /INSERT INTO .*\.source_ingestion_audit/.test(c.sql)));
  assert.equal(restore.calls.find(c => /UPDATE .*\.source_visibility SET/.test(c.sql)).values[2], 'active');
  const changed = hidden(); changed.state.contactRows[0].payload.name = 'Changed Synthetic';
  assert.deepEqual(await importOne(changed), { kind: 'restored', inquiryId: 'opp_a', version: 9 });
  assert.equal(changed.calls.filter(c => /UPDATE .*\.inquiries/.test(c.sql)).length, 1);
  assert.equal(changed.calls.filter(c => /INSERT INTO .*\.source_ingestion_audit/.test(c.sql)).length, 1);
  const rebound = hidden(); rebound.state.link.source_event_id = 'different';
  assert.equal((await importOne(rebound)).kind, 'quarantined');
  assert.ok(!rebound.calls.some(c => /UPDATE .*\.inquiries|UPDATE .*\.source_links/.test(c.sql)));
  const stale = hidden(); await assert.rejects(stale.importer().importInquiry({ opportunityId: 'opp_a', expectedVersion: 7 }), code('version_conflict'));
  assert.ok(!stale.calls.some(c => /^INSERT INTO|^UPDATE /.test(c.sql)));
});

test('unexpected/spoofed source failures and visibility audit failures never report successful hiding', async () => {
  const driver = harness({ existing: true });
  driver.state.fail = sql => sql.includes('.recovery_opportunities') ? Object.assign(new Error('PRIVATE_DIAGNOSTIC'), { code: 'source_event_missing', name: 'SourceIngestionError' }) : false;
  await assert.rejects(importOne(driver), code('source_database_error'));
  assert.ok(!driver.calls.some(c => /UPDATE .*\.source_visibility|INSERT INTO .*\.source_visibility_audit/.test(c.sql)));
  const audit = harness({ existing: true }); audit.state.eventRows = [];
  audit.state.fail = sql => /INSERT INTO .*\.source_visibility_audit/.test(sql);
  await assert.rejects(importOne(audit), code('source_database_error')); assert.equal(audit.calls.at(-1).sql, 'ROLLBACK');
  const unknown = harness({ existing: true }); unknown.state.eventRows = []; unknown.state.fail = sql => sql === 'COMMIT';
  await assert.rejects(importOne(unknown), code('source_commit_uncertain')); assert.deepEqual(unknown.releases, [true]);
});

test('schema visibility constraints match closed reason list and make binding identity immutable', async () => {
  const ddl = await readFile(new URL('../server/schema.source-ingestion.sql', import.meta.url), 'utf8');
  assert.match(ddl, /CREATE TABLE bookedradar_portal.source_visibility \(/);
  assert.match(ddl, /CREATE TABLE bookedradar_portal.source_visibility_audit \(/);
  assert.match(ddl, /source_link_identity_immutable BEFORE UPDATE/);
  assert.match(ddl, /source_binding_immutable/);
  assert.match(ddl, /valid_until<=checked_at\+INTERVAL '60 seconds'/);
  for (const reason of SOURCE_REJECTION_CODES) assert.ok(ddl.includes(`'${reason}'`));
});


test('visibility CAS and version exhaustion cannot report a completed safety transition', async () => {
  const stale = harness({ existing: true }); stale.state.eventRows = []; stale.state.visibilityUpdateCount = 0;
  await assert.rejects(importOne(stale), code('visibility_revision_conflict'));
  assert.equal(stale.calls.at(-1).sql, 'ROLLBACK');
  assert.ok(!stale.calls.some(c => /INSERT INTO .*\.source_visibility_audit/.test(c.sql)));
  const exhausted = harness({ existing: true }); exhausted.state.eventRows = []; exhausted.state.current.version = String(Number.MAX_SAFE_INTEGER);
  await assert.rejects(importOne(exhausted), code('version_exhausted'));
  assert.equal(exhausted.calls.at(-1).sql, 'ROLLBACK');
  assert.ok(!exhausted.calls.some(c => /^INSERT INTO|^UPDATE /.test(c.sql)));
});


test('SQL projection redacts malformed roots, subtrees and scalar fields before materialization', async () => {
  const h = harness(); await h.reader().readInquiry({ opportunityId: 'opp_a' });
  const queries = h.calls.filter(c => c.sql.includes('FROM "bookedradar".recovery_'));
  for (const { sql } of queries) {
    assert.doesNotMatch(sql, /ELSE r\.payload|ELSE v\b/);
    assert.match(sql, /ELSE 'null'::jsonb END/);
    assert.match(sql, /WHEN 'synthetic' THEN CASE WHEN jsonb_typeof\(v\) IN \('boolean'\)/);
  }
  const contact = queries.find(c => c.sql.includes('.recovery_contacts'));
  assert.match(contact.sql, /CASE WHEN NOT EXISTS/);
  assert.match(contact.sql, /WHEN 'kind' THEN jsonb_typeof\(v\) IN \('string'\)/);
  assert.match(contact.sql, /WHEN 'name' THEN CASE WHEN jsonb_typeof\(v\) IN \('string'\) THEN v ELSE 'null'::jsonb END/);
  const event = queries.find(c => c.sql.includes('r.event_id=$2'));
  assert.match(event.sql, /WHEN 'occurredAt' THEN CASE WHEN jsonb_typeof\(v\) IN \('string','number'\)/);
  for (const [collection, key, expected] of [['opportunityRows', null, 'invalid_source_payload'], ['contactRows', 'metadata', 'invalid_source_metadata'],
    ['eventRows', 'contact', 'invalid_event_contact'], ['contactRows', 'name', 'invalid_contact_name'], ['eventRows', 'id', 'source_column_id_mismatch']]) {
    const rejected = harness();
    // Model the fixed null emitted by SQL for synthetic array/string/object
    // canaries. Real PostgreSQL integration tests verify raw result redaction.
    if (key === null) rejected.state[collection][0].payload = null;
    else rejected.state[collection][0].payload[key] = null;
    await assert.rejects(importOne(rejected), code(expected));
  }
});
