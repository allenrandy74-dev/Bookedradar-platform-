import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { API_PREFIX, MAX_BODY_BYTES, MAX_NOTE_LENGTH, createCustomerPortalHandler, createCustomerPortalService } from '../server/api.mjs';

const NOW = new Date('2026-10-12T12:00:00Z');
const ORIGIN = 'https://portal.example.test';
const CSRF = 'synthetic-test-only-csrf-value-00000001';
const principal = { userId: 'user-a', memberId: 'member-a', tenantId: 'tenant-a', tenantName: 'Example A', expiresAt: '2026-10-12T13:00:00Z', csrfToken: CSRF };
const clone = value => structuredClone(value);
const member = (id, tenantId, role = 'operator', active = true) => ({ id, tenantId, userId: id.replace('member', 'user'), name: `Test ${id}`, role, active, internalCredential: 'never expose this' });
const inquiry = (id, tenantId) => ({ id, tenantId, customerName: 'Synthetic Customer', contact: { email: 'customer@example.test', phone: '+15550100101', providerContactId: 'secret-source-id' }, subject: 'Leaking faucet', summary: 'Synthetic repair inquiry', source: 'phone', receivedAt: NOW.toISOString(), updatedAt: NOW.toISOString(), status: 'new', assigneeId: null, version: 1, notes: [], providerDispatchState: 'do-not-expose', revenue: 900, internalToken: 'never expose this' });

// Synthetic test-only store. No runtime imports this class. Production needs durable
// tenant-scoped reads and a SERIALIZABLE/locked transaction with atomic audit commit.
class SyntheticStore {
  constructor() {
    this.members = new Map([
      ['tenant-a', new Map([member('member-a', 'tenant-a'), member('member-a2', 'tenant-a'), member('member-reader', 'tenant-a', 'viewer'), member('member-off', 'tenant-a', 'operator', false)].map(value => [value.id, value]))],
      ['tenant-b', new Map([member('member-b', 'tenant-b')].map(value => [value.id, value]))],
    ]);
    this.inquiries = new Map([
      ['tenant-a', new Map([inquiry('inquiry-a', 'tenant-a'), inquiry('same-id', 'tenant-a')].map(value => [value.id, value]))],
      ['tenant-b', new Map([inquiry('inquiry-b', 'tenant-b'), inquiry('same-id', 'tenant-b')].map(value => [value.id, value]))],
    ]);
    this.audits = [];
    this.lock = Promise.resolve();
  }
  async getMember(tenantId, id) { return clone(this.members.get(tenantId)?.get(id)); }
  async listMembers(tenantId) { return clone([...this.members.get(tenantId).values()]); }
  async getInquiry(tenantId, id) { return clone(this.inquiries.get(tenantId)?.get(id)); }
  async listInquiries(tenantId, limit) { return clone([...this.inquiries.get(tenantId).values()].slice(0, limit)); }
  async transaction(tenantId, operation) {
    const previous = this.lock;
    let release;
    this.lock = new Promise(resolve => { release = resolve; });
    await previous;
    try {
      if (this.beforeTransaction) await this.beforeTransaction();
      const rows = clone(this.inquiries.get(tenantId));
      const people = clone(this.members.get(tenantId));
      const audit = [];
      const result = await operation({
        getInquiry: async id => clone(rows.get(id)),
        getMember: async id => clone(people.get(id)),
        saveInquiry: async row => { assert.equal(row.tenantId, tenantId); rows.set(row.id, clone(row)); },
        appendAudit: async event => { if (this.failAudit) throw new Error('private database details'); assert.equal(event.tenantId, tenantId); audit.push(clone(event)); },
      });
      this.inquiries.set(tenantId, rows);
      this.audits.push(...audit);
      return result;
    } finally { release(); }
  }
}
function setup(options = {}) {
  const store = options.store || new SyntheticStore();
  const service = createCustomerPortalService({ store, resolveSession: async () => clone(principal), allowedOrigins: [ORIGIN], now: () => NOW, ...options });
  const request = (method, suffix, body, headers = {}) => service({ method, url: `${API_PREFIX}${suffix}`, body, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json', origin: ORIGIN, 'x-csrf-token': CSRF }), ...headers } });
  return { store, service, request };
}
const errorIs = (response, status, error) => { assert.equal(response.status, status); assert.equal(response.body.ok, false); assert.equal(response.body.error, error); };

test('unconfigured scaffold denies all access even with a shared admin token', async () => {
  const service = createCustomerPortalService();
  errorIs(await service({ url: `${API_PREFIX}/inquiries`, headers: { authorization: 'Bearer synthetic-admin' } }), 503, 'portal_not_configured');
});

test('missing, expired, forged and wrong-member sessions are rejected', async () => {
  errorIs(await setup({ resolveSession: async () => null }).request('GET', '/inquiries'), 401, 'authentication_required');
  errorIs(await setup({ resolveSession: async () => ({ ...principal, expiresAt: '2020-01-01T00:00:00Z' }) }).request('GET', '/inquiries'), 401, 'invalid_session');
  errorIs(await setup({ resolveSession: async () => ({ ...principal, tenantId: 'tenant-b' }) }).request('GET', '/inquiries'), 403, 'membership_required');
  errorIs(await setup({ resolveSession: async () => ({ ...principal, userId: 'attacker' }) }).request('GET', '/inquiries'), 403, 'membership_required');
});

test('tenant selectors in headers, query or mutation body are forbidden', async () => {
  const { request } = setup();
  for (const key of ['x-bookedradar-tenant', 'X-Tenant-ID', 'tenant']) errorIs(await request('GET', '/inquiries', undefined, { [key]: 'tenant-b' }), 400, 'tenant_selector_forbidden');
  for (const key of ['tenant', 'tenantId', 'tenant_id']) errorIs(await request('GET', `/inquiries?${key}=tenant-b`), 400, 'tenant_selector_forbidden');
  errorIs(await request('PATCH', '/inquiries/inquiry-a', { version: 1, status: 'closed', tenantId: 'tenant-b' }), 400, 'tenant_selector_forbidden');
});

test('session is server-bound and uses current membership role', async () => {
  const { request } = setup();
  const result = await request('GET', '/session');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.session, { userId: 'user-a', memberId: 'member-a', tenant: { id: 'tenant-a', name: 'Example A' }, role: 'operator', canEdit: true });
  assert.equal(result.body.csrfToken, CSRF);
  assert.match(result.headers['cache-control'], /no-store/);
});

test('collection and detail never return another tenant or raw provider fields', async () => {
  const { request } = setup();
  const list = await request('GET', '/inquiries');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.inquiries.map(item => item.id), ['inquiry-a', 'same-id']);
  const encoded = JSON.stringify(list.body);
  for (const value of ['tenant-b', 'tenantId', 'provider', 'revenue', 'internalToken', 'secret-source-id']) assert.equal(encoded.includes(value), false);
  errorIs(await request('GET', '/inquiries/inquiry-b'), 404, 'not_found');
  errorIs(await request('GET', '/inquiries/missing'), 404, 'not_found');
  assert.equal((await request('GET', '/inquiries/same-id')).body.inquiry.customerName, 'Synthetic Customer');
});

test('members exposes only active tenant operators with minimal fields', async () => {
  const result = await setup().request('GET', '/members');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.members, [{ id: 'member-a', name: 'Test member-a' }, { id: 'member-a2', name: 'Test member-a2' }]);
});

test('successful status and assignment patch commits a single safe audit', async () => {
  const { request, store } = setup();
  const result = await request('PATCH', '/inquiries/inquiry-a', { version: 1, status: 'in_progress', assigneeId: 'member-a2' });
  assert.equal(result.status, 200);
  assert.equal(result.body.inquiry.version, 2);
  assert.equal(result.body.inquiry.status, 'in_progress');
  assert.equal(result.body.inquiry.assigneeId, 'member-a2');
  assert.equal(store.audits.length, 1);
  assert.deepEqual(store.audits[0].fields, ['status', 'assigneeId']);
  for (const field of ['text', 'customerName', 'contact', 'csrfToken', 'authorization', 'summary']) assert.equal(OWN(store.audits[0], field), false);
  assert.equal((await store.getInquiry('tenant-a', 'inquiry-a')).providerDispatchState, 'do-not-expose');
});
const OWN = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

test('cross-tenant detail, patch and notes give the same not-found response', async () => {
  const { request, store } = setup();
  errorIs(await request('PATCH', '/inquiries/inquiry-b', { version: 1, status: 'closed' }), 404, 'not_found');
  errorIs(await request('POST', '/inquiries/inquiry-b/notes', { version: 1, text: 'Do not save' }), 404, 'not_found');
  assert.equal(store.audits.length, 0);
  assert.equal((await store.getInquiry('tenant-b', 'inquiry-b')).version, 1);
});

test('invalid, inactive, read-only and cross-tenant assignees cannot be assigned', async () => {
  for (const assigneeId of ['member-b', 'member-off', 'member-reader', 'missing', '../escape']) {
    const { request, store } = setup();
    errorIs(await request('PATCH', '/inquiries/inquiry-a', { version: 1, assigneeId }), 400, 'invalid_assignee');
    assert.equal(store.audits.length, 0);
    assert.equal((await store.getInquiry('tenant-a', 'inquiry-a')).version, 1);
  }
});

test('unassignment is allowed and same-value patch is rejected without a write', async () => {
  const { request, store } = setup();
  errorIs(await request('PATCH', '/inquiries/inquiry-a', { version: 1, assigneeId: null }), 400, 'no_change');
  await request('PATCH', '/inquiries/inquiry-a', { version: 1, assigneeId: 'member-a2' });
  assert.equal((await request('PATCH', '/inquiries/inquiry-a', { version: 2, assigneeId: null })).body.inquiry.assigneeId, null);
  assert.equal(store.audits.length, 2);
});

test('stale and concurrent updates cannot overwrite a newer version', async () => {
  const { request, store } = setup();
  const pair = await Promise.all([
    request('PATCH', '/inquiries/inquiry-a', { version: 1, status: 'in_progress' }),
    request('POST', '/inquiries/inquiry-a/notes', { version: 1, text: 'Concurrent synthetic note' }),
  ]);
  assert.deepEqual(pair.map(value => value.status).sort(), [200, 409]);
  errorIs(await request('PATCH', '/inquiries/inquiry-a', { version: 1, status: 'closed' }), 409, 'version_conflict');
  assert.equal(store.audits.length, 1);
});

test('status transitions are explicit and cannot mark confirmed bookings or revenue', async () => {
  const { request } = setup();
  errorIs(await request('PATCH', '/inquiries/inquiry-a', { version: 1, status: 'waiting' }), 409, 'invalid_status_transition');
  errorIs(await request('PATCH', '/inquiries/inquiry-a', { version: 1, status: 'booked' }), 400, 'invalid_status');
  for (const [version, status] of [[1, 'in_progress'], [2, 'waiting'], [3, 'closed'], [4, 'in_progress']]) assert.equal((await request('PATCH', '/inquiries/inquiry-a', { version, status })).status, 200);
  errorIs(await request('PATCH', '/inquiries/inquiry-a', { version: 5, status: 'new' }), 409, 'invalid_status_transition');
});

test('bounded notes are plain data with server-selected author and safe audits', async () => {
  const { request, store } = setup();
  const result = await request('POST', '/inquiries/inquiry-a/notes', { version: 1, text: '  <script>synthetic text</script>  ' });
  assert.equal(result.status, 201);
  assert.equal(result.body.inquiry.notes[0].authorId, 'member-a');
  assert.equal(result.body.inquiry.notes[0].text, '<script>synthetic text</script>');
  assert.equal(JSON.stringify(store.audits).includes('<script>'), false);
  for (const text of ['', '  ', 'a'.repeat(MAX_NOTE_LENGTH + 1), 'bad\u0000control', 12]) errorIs(await request('POST', '/inquiries/inquiry-a/notes', { version: 2, text }), 400, 'invalid_note');
  errorIs(await request('POST', '/inquiries/inquiry-a/notes', { version: 2, text: 'x', authorId: 'member-b' }), 400, 'unknown_field');
});

test('unknown mutation fields and malformed optimistic versions are rejected', async () => {
  const { request } = setup();
  for (const field of ['revenue', 'booking', 'contact', 'sendSms', 'role']) errorIs(await request('PATCH', '/inquiries/inquiry-a', { version: 1, status: 'closed', [field]: 'x' }), 400, 'unknown_field');
  for (const version of [undefined, '1', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) errorIs(await request('PATCH', '/inquiries/inquiry-a', { version, status: 'closed' }), 400, 'version_required');
  errorIs(await request('PATCH', '/inquiries/inquiry-a', { version: 1 }), 400, 'empty_patch');
});

test('read-only membership reads inquiries but cannot mutate', async () => {
  const { request } = setup({ resolveSession: async () => ({ ...principal, userId: 'user-reader', memberId: 'member-reader', role: 'operator' }) });
  assert.equal((await request('GET', '/inquiries')).status, 200);
  assert.equal((await request('GET', '/session')).body.session.canEdit, false);
  errorIs(await request('PATCH', '/inquiries/inquiry-a', { version: 1, status: 'closed' }), 403, 'read_only_membership');
  errorIs(await request('POST', '/inquiries/inquiry-a/notes', { version: 1, text: 'x' }), 403, 'read_only_membership');
});

test('origin and CSRF must be configured and exact for every unsafe method', async () => {
  const patch = { version: 1, status: 'closed' };
  errorIs(await setup({ allowedOrigins: [] }).request('PATCH', '/inquiries/inquiry-a', patch), 503, 'write_protection_not_configured');
  errorIs(await setup({ resolveSession: async () => ({ ...principal, csrfToken: undefined }) }).request('PATCH', '/inquiries/inquiry-a', patch), 503, 'write_protection_not_configured');
  const { request } = setup();
  for (const origin of ['', 'https://attacker.test', 'https://portal.example.test.attacker.test', 'null']) errorIs(await request('PATCH', '/inquiries/inquiry-a', patch, { origin }), 403, 'origin_forbidden');
  for (const token of ['', 'wrong']) errorIs(await request('PATCH', '/inquiries/inquiry-a', patch, { 'x-csrf-token': token }), 403, 'csrf_failed');
  errorIs(await request('GET', '/session', undefined, { 'sec-fetch-site': 'cross-site' }), 403, 'origin_forbidden');
  errorIs(await request('PATCH', '/inquiries/inquiry-a', patch, { 'content-type': 'text/plain' }), 415, 'json_required');
});

test('audit failure rolls back the inquiry mutation', async () => {
  const { request, store } = setup(); store.failAudit = true;
  errorIs(await request('PATCH', '/inquiries/inquiry-a', { version: 1, status: 'closed' }), 503, 'portal_unavailable');
  assert.equal((await store.getInquiry('tenant-a', 'inquiry-a')).version, 1);
  assert.equal(store.audits.length, 0);
});

test('membership revocation between authentication and write fails inside transaction', async () => {
  const { request, store } = setup();
  store.beforeTransaction = () => { store.members.get('tenant-a').get('member-a').active = false; };
  errorIs(await request('PATCH', '/inquiries/inquiry-a', { version: 1, status: 'closed' }), 403, 'membership_required');
  assert.equal((await store.getInquiry('tenant-a', 'inquiry-a')).version, 1);
});

test('incorrectly scoped store output and cross-tenant links fail closed', async () => {
  const first = setup();
  first.store.listInquiries = async () => [inquiry('inquiry-b', 'tenant-b')];
  errorIs(await first.request('GET', '/inquiries'), 503, 'data_unavailable');
  const second = setup();
  second.store.inquiries.get('tenant-a').get('inquiry-a').assigneeId = 'member-b';
  errorIs(await second.request('GET', '/inquiries/inquiry-a'), 503, 'data_unavailable');
  const third = setup();
  third.store.inquiries.get('tenant-a').get('inquiry-a').notes.push({ id: 'note-b', tenantId: 'tenant-b', inquiryId: 'inquiry-a', authorId: 'member-b', text: 'cross-tenant', createdAt: NOW.toISOString() });
  errorIs(await third.request('GET', '/inquiries/inquiry-a'), 503, 'data_unavailable');
  const fourth = setup();
  fourth.store.inquiries.get('tenant-a').get('inquiry-a').notes.push({ id: 'note-b', tenantId: 'tenant-a', inquiryId: 'inquiry-a', authorId: 'member-b', text: 'cross-tenant', createdAt: NOW.toISOString() });
  errorIs(await fourth.request('GET', '/inquiries/inquiry-a'), 503, 'data_unavailable');
});

test('lists are bounded and unsupported routes do not expose operational mutations', async () => {
  const { request } = setup();
  assert.equal((await request('GET', '/inquiries?limit=1')).body.inquiries.length, 1);
  for (const query of ['limit=101', 'limit=0', 'limit=abc', 'limit=1&limit=2']) errorIs(await request('GET', `/inquiries?${query}`), 400, 'invalid_limit');
  for (const route of ['/send', '/booking', '/revenue', '/admin', '/inquiries/inquiry-a/send']) errorIs(await request('POST', route, { version: 1 }), 404, 'not_found');
  errorIs(await request('DELETE', '/inquiries/inquiry-a', { version: 1 }), 405, 'method_not_allowed');
});

test('unexpected resolver errors never leak credentials or private diagnostics', async () => {
  const { request } = setup({ resolveSession: async () => { throw new Error('private-user-token'); } });
  const result = await request('GET', '/session');
  errorIs(result, 503, 'portal_unavailable');
  assert.equal(JSON.stringify(result).includes('private-user-token'), false);
});

test('Node adapter enforces JSON parsing and byte bounds on real HTTP requests', async t => {
  const store = new SyntheticStore();
  const server = createServer(createCustomerPortalHandler({ store, resolveSession: async () => principal, allowedOrigins: [ORIGIN], now: () => NOW }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}${API_PREFIX}`;
  const headers = { 'content-type': 'application/json', origin: ORIGIN, 'x-csrf-token': CSRF };
  const ok = await fetch(`${base}/inquiries/inquiry-a`, { method: 'PATCH', headers, body: JSON.stringify({ version: 1, status: 'closed' }) });
  assert.equal(ok.status, 200);
  const malformed = await fetch(`${base}/inquiries/inquiry-a`, { method: 'PATCH', headers, body: '{broken' });
  assert.equal(malformed.status, 400); assert.equal((await malformed.json()).error, 'invalid_json');
  const huge = await fetch(`${base}/inquiries/inquiry-a/notes`, { method: 'POST', headers, body: JSON.stringify({ version: 2, text: 'a'.repeat(MAX_BODY_BYTES) }) });
  assert.equal(huge.status, 413);
});
test('HTTP origins are limited to loopback and cannot configure production writes', async()=>{
  errorIs(await setup({allowedOrigins:['http://portal.example.test']}).request('PATCH','/inquiries/inquiry-a',{version:1,status:'closed'},{origin:'http://portal.example.test'}),503,'write_protection_not_configured');
  assert.equal((await setup({allowedOrigins:['http://127.0.0.1:4178']}).request('PATCH','/inquiries/inquiry-a',{version:1,status:'closed'},{origin:'http://127.0.0.1:4178'})).status,200);
});
