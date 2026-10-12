import { randomUUID, timingSafeEqual } from 'node:crypto';

export const API_PREFIX = '/api/customer-portal/v1';
export const STATUSES = Object.freeze(['new', 'in_progress', 'waiting', 'closed']);
export const MAX_NOTE_LENGTH = 2000;
export const MAX_BODY_BYTES = 8192;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const TRANSITIONS = Object.freeze({
  new: ['in_progress', 'closed'],
  in_progress: ['waiting', 'closed'],
  waiting: ['in_progress', 'closed'],
  closed: ['in_progress'],
});
const OWN = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

class ApiError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const fail = (status, code) => { throw new ApiError(status, code); };
const assert = (condition, status, code) => { if (!condition) fail(status, code); };
const validId = value => typeof value === 'string' && ID.test(value);
const cleanText = (value, max) => typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const isoDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const forbiddenSelector = key => key.toLowerCase().replace(/[^a-z0-9]/g, '').includes('tenant');
const headersOf = headers => {
  const output = {};
  for (const [key, value] of Object.entries(headers || {})) output[key.toLowerCase()] = value;
  return output;
};
const equalToken = (left, right) => {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length > 512 || right.length > 512) return false;
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
};

function verifyMember(member, tenantId, userId) {
  assert(member && member.tenantId === tenantId && member.active === true && validId(member.id)
    && validId(member.userId) && ['viewer', 'operator'].includes(member.role)
    && (!userId || member.userId === userId), 403, 'membership_required');
  return member;
}

function inquiryDto(row, tenantId) {
  // No spreads of source/provider records. A malformed cross-tenant child fails closed.
  assert(row && row.tenantId === tenantId && validId(row.id), 503, 'data_unavailable');
  assert(STATUSES.includes(row.status) && Number.isSafeInteger(row.version) && row.version > 0
    && Array.isArray(row.notes) && row.notes.length <= 1000, 503, 'data_unavailable');
  assert(row.assigneeId === null || validId(row.assigneeId), 503, 'data_unavailable');
  const text = (value, max) => { assert(cleanText(value, max), 503, 'data_unavailable'); return value; };
  const date = value => { assert(isoDate(value), 503, 'data_unavailable'); return value; };
  return {
    id: row.id,
    customerName: text(row.customerName, 200),
    contact: { email: text(row.contact?.email || '', 320), phone: text(row.contact?.phone || '', 80) },
    subject: text(row.subject, 300),
    summary: text(row.summary, 4000),
    source: text(row.source, 80),
    receivedAt: date(row.receivedAt), updatedAt: date(row.updatedAt),
    status: row.status, assigneeId: row.assigneeId, version: row.version,
    notes: row.notes.map(note => {
      assert(note.tenantId === tenantId && note.inquiryId === row.id && validId(note.id)
        && validId(note.authorId), 503, 'data_unavailable');
      return { id: note.id, text: text(note.text, MAX_NOTE_LENGTH), authorId: note.authorId, createdAt: date(note.createdAt) };
    }),
  };
}

function parsedBody(body, allowedKeys) {
  assert(body && typeof body === 'object' && !Array.isArray(body), 400, 'invalid_body');
  const keys = Object.keys(body);
  assert(!keys.some(forbiddenSelector), 400, 'tenant_selector_forbidden');
  assert(keys.every(key => allowedKeys.includes(key)), 400, 'unknown_field');
  assert(Number.isSafeInteger(body.version) && body.version > 0, 400, 'version_required');
  return body;
}

/**
 * Inactive by default. resolveSession must validate an opaque, server-side session;
 * it must never derive identity/membership from a query, tenant header, or admin token.
 * See SERVER_CONTRACT.md before implementing the production adapters.
 */
export function createCustomerPortalService({ resolveSession, store, allowedOrigins = [], now = () => new Date(), id = randomUUID } = {}) {
  const origins = new Set((Array.isArray(allowedOrigins) ? allowedOrigins : []).filter(origin => {
    try { const u = new URL(origin); return u.origin === origin && (u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))); } catch { return false; }
  }));
  const configured = typeof resolveSession === 'function' && store && ['getMember', 'listMembers', 'getInquiry', 'listInquiries', 'transaction'].every(key => typeof store[key] === 'function');
  return async function handle(input = {}) {
    const requestId = randomUUID();
    const responseHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store, private', pragma: 'no-cache', 'x-content-type-options': 'nosniff', vary: 'Cookie, Authorization, Origin' };
    const response = (status, body) => ({ status, headers: responseHeaders, body: { ...body, requestId } });
    try {
      assert(configured, 503, 'portal_not_configured');
      const method = String(input.method || 'GET').toUpperCase();
      const headers = headersOf(input.headers);
      const url = new URL(input.url || '/', 'https://portal.invalid');
      assert(!Object.keys(headers).some(forbiddenSelector) && ![...url.searchParams.keys()].some(forbiddenSelector), 400, 'tenant_selector_forbidden');
      assert(headers['sec-fetch-site'] !== 'cross-site', 403, 'origin_forbidden');
      assert(!['GET', 'HEAD', 'OPTIONS'].includes(method) || headers.origin === undefined || (typeof headers.origin === 'string' && origins.has(headers.origin)), 403, 'origin_forbidden');
      const principal = await resolveSession({ method, url: input.url || '/', headers });
      assert(principal, 401, 'authentication_required');
      assert(validId(principal.userId) && validId(principal.memberId) && validId(principal.tenantId)
        && cleanText(principal.tenantName, 200) && isoDate(principal.expiresAt)
        && Date.parse(principal.expiresAt) > now().getTime(), 401, 'invalid_session');
      if (principal.sessionHash && method === 'GET' && url.pathname !== `${API_PREFIX}/session`) {
        assert(equalToken(headers['x-csrf-token'], principal.csrfToken), 401, 'session_changed');
      }
      const { tenantId, memberId, userId } = principal;
      const member = verifyMember(await store.getMember(tenantId, memberId), tenantId, userId);
      assert(member.id === memberId, 403, 'membership_required');
      const verifyLinks = async (row, lookup) => {
        if (row.assigneeId !== null) {
          const assignee = await lookup(row.assigneeId);
          assert(assignee && assignee.id === row.assigneeId && assignee.tenantId === tenantId, 503, 'data_unavailable');
        }
        for (const note of row.notes || []) {
          const author = await lookup(note.authorId);
          assert(author && author.id === note.authorId && author.tenantId === tenantId, 503, 'data_unavailable');
        }
      };
      const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(method);
      if (unsafe) {
        assert(member.role === 'operator', 403, 'read_only_membership');
        assert(origins.size > 0 && typeof principal.csrfToken === 'string' && principal.csrfToken.length >= 32 && principal.csrfToken.length <= 512, 503, 'write_protection_not_configured');
        assert(typeof headers.origin === 'string' && origins.has(headers.origin), 403, 'origin_forbidden');
        assert(equalToken(headers['x-csrf-token'], principal.csrfToken), 403, 'csrf_failed');
        assert(headers['content-type']?.split(';')[0].trim().toLowerCase() === 'application/json', 415, 'json_required');
      }
      assert(!['GET', 'HEAD'].includes(method) || input.body === undefined, 400, 'unexpected_body');
      assert([...url.searchParams.keys()].every(key => url.pathname === `${API_PREFIX}/inquiries` && key === 'limit'), 400, 'unknown_query');
      if (method === 'GET' && url.pathname === `${API_PREFIX}/session`) {
        return response(200, { ok: true, session: { userId, memberId, tenant: { id: tenantId, name: principal.tenantName }, role: member.role, canEdit: member.role === 'operator' && origins.size > 0 && typeof principal.csrfToken === 'string' && principal.csrfToken.length >= 32 && principal.csrfToken.length <= 512 }, csrfToken: typeof principal.csrfToken === 'string' ? principal.csrfToken : null });
      }
      if (method === 'GET' && url.pathname === `${API_PREFIX}/members`) {
        const members = await store.listMembers(tenantId);
        assert(Array.isArray(members) && members.length <= 1000, 503, 'data_unavailable');
        for (const candidate of members) assert(candidate.tenantId === tenantId, 503, 'data_unavailable');
        return response(200, { ok: true, members: members.filter(candidate => candidate.active === true && candidate.role === 'operator').map(candidate => {
          verifyMember(candidate, tenantId);
          assert(cleanText(candidate.name, 200), 503, 'data_unavailable');
          return { id: candidate.id, name: candidate.name };
        }) });
      }
      if (method === 'GET' && url.pathname === `${API_PREFIX}/inquiries`) {
        const rawLimit = url.searchParams.get('limit') || '100';
        assert(/^\d+$/.test(rawLimit) && Number(rawLimit) >= 1 && Number(rawLimit) <= 100 && url.searchParams.getAll('limit').length <= 1, 400, 'invalid_limit');
        const rows = await store.listInquiries(tenantId, Number(rawLimit));
        assert(Array.isArray(rows) && rows.length <= Number(rawLimit), 503, 'data_unavailable');
        const inquiries = await Promise.all(rows.map(async row => {
          const dto = inquiryDto(row, tenantId);
          await verifyLinks(row, memberId => store.getMember(tenantId, memberId));
          return dto;
        }));
        return response(200, { ok: true, inquiries, limit: Number(rawLimit) });
      }
      const match = url.pathname.match(new RegExp(`^${API_PREFIX}/inquiries/([A-Za-z0-9][A-Za-z0-9_-]{0,127})(/notes)?$`));
      assert(match, 404, 'not_found');
      const inquiryId = match[1];
      if (method === 'GET' && !match[2]) {
        const row = await store.getInquiry(tenantId, inquiryId);
        assert(row && row.id === inquiryId && row.tenantId === tenantId, 404, 'not_found');
        inquiryDto(row, tenantId);
        await verifyLinks(row, memberId => store.getMember(tenantId, memberId));
        return response(200, { ok: true, inquiry: inquiryDto(row, tenantId) });
      }
      assert((method === 'PATCH' && !match[2]) || (method === 'POST' && match[2]), 405, 'method_not_allowed');
      const body = parsedBody(input.body, method === 'PATCH' ? ['version', 'status', 'assigneeId'] : ['version', 'text']);
      if (method === 'PATCH') {
        assert(OWN(body, 'status') || OWN(body, 'assigneeId'), 400, 'empty_patch');
        assert(!OWN(body, 'status') || STATUSES.includes(body.status), 400, 'invalid_status');
        assert(!OWN(body, 'assigneeId') || body.assigneeId === null || validId(body.assigneeId), 400, 'invalid_assignee');
      } else {
        assert(cleanText(body.text, MAX_NOTE_LENGTH) && body.text.trim().length > 0, 400, 'invalid_note');
      }
      const result = await store.transaction(tenantId, async tx => {
        if (typeof tx.authorizeSession === 'function') {
          assert(await tx.authorizeSession({ sessionHash: principal.sessionHash, memberId, userId }), 401, 'authentication_required');
        }
        // Recheck membership inside the same transaction as the write to prevent revocation races.
        const actor = verifyMember(await tx.getMember(memberId), tenantId, userId);
        assert(actor.id === memberId && actor.role === 'operator', 403, 'read_only_membership');
        const row = await tx.getInquiry(inquiryId);
        assert(row && row.id === inquiryId && row.tenantId === tenantId, 404, 'not_found');
        inquiryDto(row, tenantId);
        await verifyLinks(row, memberId => tx.getMember(memberId));
        assert(row.version === body.version, 409, 'version_conflict');
        assert(row.version < Number.MAX_SAFE_INTEGER, 409, 'version_exhausted');
        const next = structuredClone(row);
        const changes = [];
        if (method === 'PATCH') {
          if (OWN(body, 'status') && body.status !== row.status) {
            assert(TRANSITIONS[row.status].includes(body.status), 409, 'invalid_status_transition');
            next.status = body.status; changes.push('status');
          }
          if (OWN(body, 'assigneeId')) {
            if (body.assigneeId !== null) {
              const assignee = await tx.getMember(body.assigneeId);
              assert(assignee?.tenantId === tenantId && assignee.id === body.assigneeId && assignee.active === true && assignee.role === 'operator', 400, 'invalid_assignee');
            }
            if (body.assigneeId !== row.assigneeId) { next.assigneeId = body.assigneeId; changes.push('assigneeId'); }
          }
          assert(changes.length > 0, 400, 'no_change');
        } else {
          assert(next.notes.length < 1000, 409, 'note_limit_reached');
          next.notes.push({ id: id(), tenantId, inquiryId, text: body.text.trim(), authorId: memberId, createdAt: now().toISOString() });
          changes.push('note');
        }
        next.version += 1; next.updatedAt = now().toISOString();
        // Prove the resulting minimal DTO before commit; never emit raw source objects.
        const dto = inquiryDto(next, tenantId);
        await verifyLinks(next, memberId => tx.getMember(memberId));
        await tx.saveInquiry(next);
        // Audit contains identity + changed field names, never notes/contact data or credentials.
        await tx.appendAudit({ id: id(), tenantId, inquiryId, actorId: memberId, userId, action: method === 'PATCH' ? 'inquiry.updated' : 'inquiry.note_added', fields: changes, previousVersion: row.version, version: next.version, occurredAt: next.updatedAt, requestId });
        return dto;
      });
      return response(method === 'POST' ? 201 : 200, { ok: true, inquiry: result });
    } catch (error) {
      // Deliberately do not reflect/log exception messages, headers, body, session or source records.
      return response(error instanceof ApiError ? error.status : 503, { ok: false, error: error instanceof ApiError ? error.code : 'portal_unavailable' });
    }
  };
}

/** Node HTTP adapter. No listener, routing mount, credential, provider mutation or deploy is created. */
export function createCustomerPortalHandler(options = {}) {
  const service = createCustomerPortalService(options);
  return async function customerPortalHandler(req, res) {
    const send = result => { res.writeHead(result.status, result.headers); res.end(JSON.stringify(result.body)); };
    const error = (status, code) => send({ status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store, private', 'x-content-type-options': 'nosniff' }, body: { ok: false, error: code } });
    try {
      let size = 0; const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) { error(413, 'body_too_large'); return; }
        chunks.push(chunk);
      }
      let body;
      if (size) {
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { error(400, 'invalid_json'); return; }
      }
      send(await service({ method: req.method, url: req.url, headers: req.headers, body }));
    } catch { if (!res.headersSent) error(400, 'invalid_request'); }
  };
}
