import { assertStagingConfig, guardStagingPool } from './staging-config.mjs';
// No pg import or connection creation: inject an already authorized pg Pool.
// No migration execution, session creation, membership grants, or provider writes.
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SCHEMA = /^bookedradar_portal(?:_test_[a-f0-9]{12}|_staging)?$/;
const TRANSITIONS = { new: ['in_progress', 'closed'], in_progress: ['waiting', 'closed'], waiting: ['in_progress', 'closed'], closed: ['in_progress'] };
const ensure = (condition, code) => { if (!condition) throw new Error(code); };
const validId = value => typeof value === 'string' && ID.test(value);
const iso = value => value instanceof Date ? value.toISOString() : new Date(value).toISOString();
const copy = value => structuredClone(value);
const memberDto = row => row && ({ id: row.id, tenantId: row.tenant_id, userId: row.user_id, name: row.name, role: row.role, active: row.active });
const inquiryDto = row => row && ({
  id: row.id, tenantId: row.tenant_id, customerName: row.customer_name,
  contact: { email: row.contact_email, phone: row.contact_phone }, subject: row.subject,
  summary: row.summary, source: row.source, receivedAt: iso(row.received_at), updatedAt: iso(row.updated_at),
  status: row.status, assigneeId: row.assignee_id, version: Number(row.version),
  notes: (row.notes || []).map(note => ({ id: note.id, tenantId: note.tenant_id, inquiryId: note.inquiry_id, authorId: note.author_id, text: note.text, createdAt: iso(note.created_at) })),
});
const unchangedNote = (a, b) => a.id === b.id && a.tenantId === b.tenantId && a.inquiryId === b.inquiryId && a.authorId === b.authorId && a.text === b.text && a.createdAt === b.createdAt;

export function createPostgresPortalStore({ pool, schema = 'bookedradar_portal', stagingConfig } = {}) {
  ensure(pool && typeof pool.query === 'function' && typeof pool.connect === 'function', 'portal_pool_required');
  ensure(SCHEMA.test(schema), 'invalid_portal_schema');
  if (schema === 'bookedradar_portal_staging') { assertStagingConfig(stagingConfig); pool = guardStagingPool(pool, stagingConfig); }
  const s = `"${schema}"`;
  const memberSql = `SELECT m.id,m.tenant_id,m.user_id,m.name,m.role,m.active FROM ${s}.memberships m JOIN ${s}.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=$1 AND m.id=$2 AND t.active=true`;
  const inquirySql = `SELECT i.id,i.tenant_id,i.customer_name,i.contact_email,i.contact_phone,i.subject,i.summary,i.source,i.received_at,i.updated_at,i.status,i.assignee_id,i.version,
    COALESCE((SELECT jsonb_agg(n ORDER BY n.created_at,n.id) FROM
      (SELECT n.id,n.tenant_id,n.inquiry_id,n.author_id,n.text,n.created_at FROM ${s}.notes n
       WHERE n.tenant_id=i.tenant_id AND n.inquiry_id=i.id ORDER BY n.created_at,n.id LIMIT 1001) n), '[]'::jsonb) AS notes
    FROM ${s}.inquiries i WHERE i.tenant_id=$1`;
  const checkTenant = tenantId => ensure(validId(tenantId), 'invalid_tenant');
  const getMember = async (db, tenantId, id, lock = false) => {
    checkTenant(tenantId); ensure(validId(id), 'invalid_member');
    const result = await db.query(memberSql + (lock ? ' FOR SHARE OF m,t' : ''), [tenantId, id]);
    return memberDto(result.rows[0]);
  };
  const getInquiry = async (db, tenantId, id, lock = false) => {
    checkTenant(tenantId); ensure(validId(id), 'invalid_inquiry');
    if (lock) {
      // READ COMMITTED can replace a waited-on parent tuple through EvalPlanQual
      // while a correlated child subquery retains the pre-wait statement snapshot.
      // Acquire only the parent lock first, then obtain a fresh statement snapshot
      // for both parent and notes. All note writers must hold this parent lock.
      const locked = await db.query(`SELECT i.id FROM ${s}.inquiries i WHERE i.tenant_id=$1 AND i.id=$2 FOR UPDATE OF i`, [tenantId, id]);
      if (!locked.rows.length) return undefined;
    }
    const result = await db.query(inquirySql + ' AND i.id=$2', [tenantId, id]);
    return inquiryDto(result.rows[0]);
  };
  return Object.freeze({
    getMember: (tenantId, id) => getMember(pool, tenantId, id),
    getInquiry: (tenantId, id) => getInquiry(pool, tenantId, id),
    async listMembers(tenantId) {
      checkTenant(tenantId);
      const { rows } = await pool.query(`SELECT id,tenant_id,user_id,name,role,active FROM ${s}.memberships WHERE tenant_id=$1 ORDER BY id LIMIT 1001`, [tenantId]);
      return rows.map(memberDto);
    },
    async listInquiries(tenantId, limit = 100) {
      checkTenant(tenantId); ensure(Number.isSafeInteger(limit) && limit >= 1 && limit <= 100, 'invalid_limit');
      const { rows } = await pool.query(inquirySql + ' ORDER BY i.received_at DESC,i.id LIMIT $2', [tenantId, limit]);
      return rows.map(inquiryDto);
    },
    async getSessionByTokenHash(hash) {
      ensure(typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash), 'invalid_session_hash');
      // A hash lookup is the single allowed non-tenant lookup: it resolves trusted
      // server-held session identity before any customer object can be accessed.
      const { rows } = await pool.query(`SELECT se.tenant_id,se.member_id,se.user_id,se.expires_at,se.revoked_at,t.name AS tenant_name
        FROM ${s}.sessions se
        JOIN ${s}.memberships m ON m.tenant_id=se.tenant_id AND m.id=se.member_id AND m.user_id=se.user_id
        JOIN ${s}.tenants t ON t.id=se.tenant_id
        ${schema === 'bookedradar_portal_staging' ? `JOIN ${s}.login_browsers br ON br.browser_hash=se.browser_hash AND br.generation_hash=se.generation_hash AND br.revoked_at IS NULL JOIN ${s}.identity_bindings b ON b.fingerprint=se.identity_fingerprint AND b.tenant_id=se.tenant_id AND b.member_id=se.member_id AND b.user_id=se.user_id AND b.active=true` : ''}
        WHERE se.token_hash=decode($1,'hex') AND se.revoked_at IS NULL AND se.expires_at>CURRENT_TIMESTAMP AND m.active=true AND t.active=true`, [hash]);
      const row = rows[0];
      return row && { tenantId: row.tenant_id, memberId: row.member_id, userId: row.user_id, tenantName: row.tenant_name, expiresAt: iso(row.expires_at), revokedAt: row.revoked_at ? iso(row.revoked_at) : null, active: true };
    },
    async transaction(tenantId, operation) {
      checkTenant(tenantId); ensure(typeof operation === 'function', 'transaction_callback_required');
      const client = await pool.connect();
      let broken = false;
      let active = false;
      let commitAttempted = false;
      const lockedRows = new Map(); const lockedMembers = new Map(); const changes = new Map(); const audited = new Set();
      const current = () => ensure(active, 'transaction_closed');
      try {
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED'); active = true;
        await client.query("SET LOCAL lock_timeout='5s'");
        await client.query("SET LOCAL statement_timeout='10s'");
        const tx = Object.freeze({
          ...(schema === 'bookedradar_portal_staging' ? { async authorizeSession({sessionHash,memberId,userId}) {
            current();
            ensure(typeof sessionHash === 'string' && /^[a-f0-9]{64}$/.test(sessionHash) && validId(memberId) && validId(userId), 'invalid_session_authorization');
            const browserLock = await client.query(`SELECT br.browser_hash FROM ${s}.login_browsers br JOIN ${s}.sessions se ON se.browser_hash=br.browser_hash AND se.generation_hash=br.generation_hash WHERE se.token_hash=decode($1,'hex') AND se.tenant_id=$2 AND br.revoked_at IS NULL FOR SHARE OF br`, [sessionHash,tenantId]);
            if (browserLock.rows.length !== 1) return false;
            const result = await client.query(`SELECT se.member_id FROM ${s}.sessions se
              JOIN ${s}.login_browsers br ON br.browser_hash=se.browser_hash AND br.generation_hash=se.generation_hash AND br.revoked_at IS NULL
              JOIN ${s}.identity_bindings b ON b.fingerprint=se.identity_fingerprint AND b.tenant_id=se.tenant_id AND b.member_id=se.member_id AND b.user_id=se.user_id
              JOIN ${s}.memberships m ON m.tenant_id=se.tenant_id AND m.id=se.member_id AND m.user_id=se.user_id
              JOIN ${s}.tenants t ON t.id=se.tenant_id
              WHERE se.token_hash=decode($1,'hex') AND se.tenant_id=$2 AND se.member_id=$3 AND se.user_id=$4
              AND se.revoked_at IS NULL AND se.expires_at>clock_timestamp() AND b.active=true AND m.active=true AND t.active=true
              FOR SHARE OF se,br,b,m,t`, [sessionHash,tenantId,memberId,userId]);
            return result.rows.length === 1;
          } } : {}),
          async getMember(id) {
            current();
            if (!lockedMembers.has(id)) lockedMembers.set(id, await getMember(client, tenantId, id, true));
            return copy(lockedMembers.get(id));
          },
          async getInquiry(id) {
            current();
            if (!lockedRows.has(id)) lockedRows.set(id, await getInquiry(client, tenantId, id, true));
            return copy(lockedRows.get(id));
          },
          async saveInquiry(next) {
            current(); ensure(next && next.tenantId === tenantId && validId(next.id), 'invalid_scoped_inquiry');
            const previous = lockedRows.get(next.id);
            ensure(previous && !changes.has(next.id), 'inquiry_lock_required');
            ensure(Number.isSafeInteger(next.version) && next.version === previous.version + 1, 'invalid_version');
            // Read-only projection columns cannot be overwritten, even by an adapter caller.
            for (const key of ['customerName', 'subject', 'summary', 'source', 'receivedAt']) ensure(next[key] === previous[key], 'source_field_read_only');
            ensure(next.contact?.email === previous.contact.email && next.contact?.phone === previous.contact.phone, 'source_field_read_only');
            ensure(Array.isArray(next.notes) && next.notes.length >= previous.notes.length && next.notes.length <= previous.notes.length + 1 && next.notes.length <= 1000, 'append_one_note_only');
            const previousById = new Map(previous.notes.map(note => [note.id, note]));
            const added = next.notes.filter(note => !previousById.has(note.id));
            ensure(next.notes.length === new Set(next.notes.map(note => note.id)).size, 'duplicate_note');
            for (const oldNote of previous.notes) ensure(next.notes.some(note => unchangedNote(note, oldNote)), 'note_is_immutable');
            ensure(added.length <= 1, 'append_one_note_only');
            const fields = [];
            if (next.status !== previous.status) {
              ensure(TRANSITIONS[previous.status]?.includes(next.status), 'invalid_status_transition');
              fields.push('status');
            }
            if (next.assigneeId !== previous.assigneeId) {
              if (next.assigneeId !== null) {
                const assignee = await tx.getMember(next.assigneeId);
                ensure(assignee?.active && assignee.role === 'operator', 'invalid_assignee');
              }
              fields.push('assigneeId');
            }
            if (added.length) fields.push('note');
            ensure(fields.length > 0 && !(added.length && fields.length > 1), 'invalid_change');
            for (const note of added) {
              ensure(note.tenantId === tenantId && note.inquiryId === next.id && validId(note.id), 'invalid_scoped_note');
              const author = await tx.getMember(note.authorId);
              ensure(author?.active && author.role === 'operator', 'invalid_note_author');
            }
            const changed = await client.query(`UPDATE ${s}.inquiries SET status=$3,assignee_id=$4,version=$5,updated_at=$6 WHERE tenant_id=$1 AND id=$2 AND version=$7`, [tenantId, next.id, next.status, next.assigneeId, next.version, next.updatedAt, previous.version]);
            ensure(changed.rowCount === 1, 'version_conflict');
            for (const note of added) await client.query(`INSERT INTO ${s}.notes (tenant_id,inquiry_id,id,author_id,text,created_at) VALUES ($1,$2,$3,$4,$5,$6)`, [tenantId, next.id, note.id, note.authorId, note.text, note.createdAt]);
            changes.set(next.id, { previous, next: copy(next), fields, added });
          },
          async appendAudit(event) {
            current(); ensure(event?.tenantId === tenantId && validId(event.id), 'invalid_scoped_audit');
            const change = changes.get(event.inquiryId);
            ensure(change && !audited.has(event.inquiryId), 'audit_requires_change');
            const actor = await tx.getMember(event.actorId);
            ensure(actor?.active && actor.role === 'operator' && actor.userId === event.userId, 'invalid_audit_actor');
            ensure(event.previousVersion === change.previous.version && event.version === change.next.version && event.occurredAt === change.next.updatedAt, 'audit_version_mismatch');
            ensure(Array.isArray(event.fields) && event.fields.length === change.fields.length && change.fields.every(field => event.fields.includes(field)), 'audit_fields_mismatch');
            ensure(event.action === (change.added.length ? 'inquiry.note_added' : 'inquiry.updated') && change.added.every(note => note.authorId === event.actorId), 'audit_action_mismatch');
            // Fixed columns only. Never serialize the caller's event or arbitrary metadata.
            await client.query(`INSERT INTO ${s}.audit_events (tenant_id,inquiry_id,id,actor_id,user_id,action,fields,previous_version,version,occurred_at,request_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [tenantId, event.inquiryId, event.id, event.actorId, event.userId, event.action, change.fields, event.previousVersion, event.version, event.occurredAt, event.requestId]);
            audited.add(event.inquiryId);
          },
        });
        const result = await operation(tx);
        ensure(changes.size === audited.size, 'atomic_audit_required');
        active = false; commitAttempted = true;
        const committed = await client.query('COMMIT');
        ensure(committed.command === 'COMMIT', 'transaction_not_committed');
        return result;
      } catch (error) {
        if (commitAttempted) broken = true;
        try { await client.query('ROLLBACK'); } catch { broken = true; }
        active = false;
        throw error;
      } finally { client.release(broken); }
    },
  });
}
