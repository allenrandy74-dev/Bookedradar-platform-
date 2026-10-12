import test from 'node:test';
import assert from 'node:assert/strict';
import { createPostgresPortalStore } from '../server/postgres-store.mjs';

const now = '2026-10-12T12:00:00.000Z';
const rawMember = { tenant_id: 'tenant-a', id: 'member-a', user_id: 'user-a', name: 'Synthetic Operator', role: 'operator', active: true };
const rawInquiry = { tenant_id: 'tenant-a', id: 'inquiry-a', customer_name: 'Synthetic', contact_email: 'test@example.test', contact_phone: '', subject: 'Example', summary: 'Synthetic request', source: 'phone', received_at: now, updated_at: now, status: 'new', assignee_id: null, version: '1', notes: [] };
function fixture({ auditFails = false, rollbackFails = false, casFails = false, commitReturnsRollback = false } = {}) {
  const calls = []; let released; let saved;
  const client = { query: async (sql, values) => {
    calls.push({ sql, values });
    if (sql === 'ROLLBACK' && rollbackFails) throw new Error('rollback failure');
    if (sql.includes('SELECT m.id')) return { rows: [structuredClone(rawMember)] };
    if (sql.includes('SELECT i.id')) return { rows: [structuredClone(rawInquiry)] };
    if (sql.startsWith('UPDATE')) { saved = values; return { rowCount: casFails ? 0 : 1 }; }
    if (sql.includes('INSERT INTO') && sql.includes('audit_events') && auditFails) throw new Error('audit failure');
    return { rows: [], rowCount: 1, command: sql === 'COMMIT' ? (commitReturnsRollback ? 'ROLLBACK' : 'COMMIT') : undefined };
  }, release: broken => { released = broken; } };
  const pool = { query: client.query, connect: async () => client };
  return { store: createPostgresPortalStore({ pool }), calls, get released() { return released; }, get saved() { return saved; } };
}
async function mutation(tx, auditOverrides = {}) {
  const actor = await tx.getMember('member-a');
  const row = await tx.getInquiry('inquiry-a');
  row.status = 'in_progress'; row.version++;
  await tx.saveInquiry(row);
  await tx.appendAudit({ tenantId: 'tenant-a', inquiryId: 'inquiry-a', id: 'audit-a', actorId: actor.id, userId: actor.userId, action: 'inquiry.updated', fields: ['status'], previousVersion: 1, version: 2, occurredAt: now, requestId: '00000000-0000-4000-8000-000000000001', ...auditOverrides });
  return row;
}

test('PostgreSQL store requires an injected pool and a safely bounded schema', () => {
  assert.throws(() => createPostgresPortalStore(), /portal_pool_required/);
  assert.throws(() => createPostgresPortalStore({ pool: { query() {}, connect() {} }, schema: 'public; DROP TABLE users' }), /invalid_portal_schema/);
  assert.throws(() => createPostgresPortalStore({ pool: { query() {}, connect() {} }, schema: 'public' }), /invalid_portal_schema/);
});

test('all inquiry and membership reads use parameterized tenant/object predicates', async () => {
  const f = fixture();
  assert.equal((await f.store.getInquiry('tenant-a', 'inquiry-a')).version, 1);
  await f.store.getMember('tenant-a', 'member-a');
  await f.store.listInquiries('tenant-a', 10);
  await f.store.listMembers('tenant-a');
  for (const call of f.calls) { assert.equal(call.values[0], 'tenant-a'); assert.match(call.sql, /tenant_id=\$1/); }
  await assert.rejects(f.store.getInquiry('tenant-a', '../escape'), /invalid_inquiry/);
  await assert.rejects(f.store.listInquiries('tenant-a', 101), /invalid_limit/);
});

test('transaction locks memberships and inquiries, CAS updates workflow columns and commits audit', async () => {
  const f = fixture();
  const result = await f.store.transaction('tenant-a', tx => mutation(tx));
  assert.equal(result.version, 2);
  assert.match(f.calls.find(call => call.sql.includes('SELECT m.id')).sql, /FOR SHARE OF m,t$/);
  assert.match(f.calls.find(call => call.sql.includes('SELECT i.id')).sql, /FOR UPDATE OF i$/);
  const update = f.calls.find(call => call.sql.startsWith('UPDATE'));
  assert.match(update.sql, /WHERE tenant_id=\$1 AND id=\$2 AND version=\$7/);
  assert.doesNotMatch(update.sql, /customer_name|contact_|provider|revenue/);
  assert.deepEqual(update.values, ['tenant-a', 'inquiry-a', 'in_progress', null, 2, now, 1]);
  assert.equal(f.calls.at(-1).sql, 'COMMIT');
  assert.equal(f.released, false);
});

test('missing audit, failed audit and mismatched audit all roll back changes', async () => {
  const noAudit = fixture();
  await assert.rejects(noAudit.store.transaction('tenant-a', async tx => { const row = await tx.getInquiry('inquiry-a'); row.version++; row.status = 'closed'; await tx.saveInquiry(row); }), /atomic_audit_required/);
  assert.equal(noAudit.calls.at(-1).sql, 'ROLLBACK');
  const fail = fixture({ auditFails: true });
  await assert.rejects(fail.store.transaction('tenant-a', tx => mutation(tx)), /audit failure/);
  assert.equal(fail.calls.at(-1).sql, 'ROLLBACK');
  for (const override of [{ version: 3 }, { fields: ['note'] }, { userId: 'other' }, { tenantId: 'tenant-b' }]) {
    const f = fixture(); await assert.rejects(f.store.transaction('tenant-a', tx => mutation(tx, override)));
    assert.equal(f.calls.at(-1).sql, 'ROLLBACK'); assert.equal(f.calls.some(call => call.sql === 'COMMIT'), false);
  }
});

test('CAS failure rolls back and rollback failure discards connection', async () => {
  const f = fixture({ casFails: true, rollbackFails: true });
  await assert.rejects(f.store.transaction('tenant-a', tx => mutation(tx)), /version_conflict/);
  assert.equal(f.released, true);
});

test('source fields, tenant identity and existing notes cannot be altered by a write', async () => {
  for (const patch of [{ subject: 'changed source' }, { tenantId: 'tenant-b' }, { contact: { email: 'other@example.test', phone: '' } }, { version: 50 }]) {
    const f = fixture();
    await assert.rejects(f.store.transaction('tenant-a', async tx => { const row = await tx.getInquiry('inquiry-a'); await tx.saveInquiry({ ...row, status: 'closed', version: 2, ...patch }); }));
    assert.equal(f.calls.some(call => call.sql.startsWith('UPDATE')), false);
  }
});

test('transaction handles cannot be used after callback commit', async () => {
  const f = fixture(); let escaped;
  await f.store.transaction('tenant-a', async tx => { escaped = tx; });
  await assert.rejects(escaped.getInquiry('inquiry-a'), /transaction_closed/);
});

test('opaque session lookup sends only validated hash and checks joined membership and expiry', async () => {
  const f = fixture(); const hash = 'a'.repeat(64);
  assert.equal(await f.store.getSessionByTokenHash(hash), undefined);
  assert.deepEqual(f.calls[0].values, [hash]);
  assert.match(f.calls[0].sql, /revoked_at IS NULL/);
  assert.match(f.calls[0].sql, /expires_at>CURRENT_TIMESTAMP/);
  assert.match(f.calls[0].sql, /m.active=true AND t.active=true/);
  await assert.rejects(f.store.getSessionByTokenHash('raw-token'), /invalid_session_hash/);
});


test('a COMMIT response that reports rollback cannot be reported as a successful save', async () => {
  const f = fixture({ commitReturnsRollback: true });
  await assert.rejects(f.store.transaction('tenant-a', tx => mutation(tx)), /transaction_not_committed/);
  assert.equal(f.released, true);
});

test('adapter enforces workflow transitions independently of the HTTP service', async () => {
  const f = fixture();
  await assert.rejects(f.store.transaction('tenant-a', async tx => {
    const row = await tx.getInquiry('inquiry-a'); row.version++; row.status = 'waiting';
    await tx.saveInquiry(row);
  }), /invalid_status_transition/);
  assert.equal(f.calls.some(call => call.sql.startsWith('UPDATE')), false);
});


test('transaction inquiry read locks only the parent, then reads notes in a fresh statement', async () => {
  const f = fixture();
  await f.store.transaction('tenant-a', async tx => {
    await tx.getInquiry('inquiry-a');
    await tx.getInquiry('inquiry-a');
  });
  const reads = f.calls.filter(call => call.sql.startsWith('SELECT i.id'));
  assert.equal(reads.length, 2, 'cached transaction reads must not acquire a second snapshot');
  assert.match(reads[0].sql, /^SELECT i.id FROM .* WHERE i.tenant_id=\$1 AND i.id=\$2 FOR UPDATE OF i$/);
  assert.doesNotMatch(reads[0].sql, /notes|jsonb_agg/);
  assert.match(reads[1].sql, /jsonb_agg/);
  assert.doesNotMatch(reads[1].sql, /FOR UPDATE/);
  assert.deepEqual(reads.map(call => call.values), [['tenant-a', 'inquiry-a'], ['tenant-a', 'inquiry-a']]);
});
