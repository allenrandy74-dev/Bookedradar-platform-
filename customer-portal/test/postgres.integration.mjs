import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { requireDisposablePostgres } from './disposable-postgres.mjs';
import { createPostgresPortalStore } from '../server/postgres-store.mjs';
import { createOpaqueSessionResolver, SESSION_COOKIE_NAME } from '../server/session-resolver.mjs';
import { createCustomerPortalService, API_PREFIX } from '../server/api.mjs';

// Fail before importing pg or opening a connection if environment is not explicitly safe.
const config = requireDisposablePostgres();
const { Pool } = await import('pg');
const schema = `bookedradar_portal_test_${randomBytes(6).toString('hex')}`;
const s = `"${schema}"`;
const ORIGIN = 'https://portal.example.test';
const tokenA = Buffer.alloc(32, 11).toString('base64url');
const tokenB = Buffer.alloc(32, 12).toString('base64url');
const tokenExpired = Buffer.alloc(32, 13).toString('base64url');
const tokenRevoked = Buffer.alloc(32, 14).toString('base64url');
const hash = token => createHash('sha256').update(token).digest('hex');

await test('isolated PostgreSQL 18 portal persistence and authorization', { timeout: 60000 }, async t => {
  const pool = new Pool({ connectionString: config.connectionString, max: 8, connectionTimeoutMillis: 3000, idleTimeoutMillis: 3000, application_name: 'bookedradar-disposable-portal-test' });
  let migrated = false;
  const assertDatabase = async () => {
    const result = await pool.query('SELECT current_database() AS name, current_setting(\'server_version_num\')::int AS version');
    assert.equal(result.rows[0].name, config.database, 'Actual database must match the guarded disposable name');
    assert.ok(result.rows[0].version >= 180000, 'Integration verification requires PostgreSQL 18 or newer');
  };
  t.after(async () => {
    try {
      if (migrated) {
        await assertDatabase();
        assert.match(schema, /^bookedradar_portal_test_[a-f0-9]{12}$/);
        // Only our unpredictable, newly created synthetic schema is removed.
        await pool.query(`DROP SCHEMA ${s} CASCADE`);
      }
    } finally { await pool.end(); }
  });
  await assertDatabase();
  const migration = await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8');
  assert.equal((await pool.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [schema])).rowCount, 0);
  // Use an explicitly held client so a failed migration can never return an
  // aborted/open transaction to the pool.
  const migrationClient = await pool.connect();
  let migrationBroken = false;
  try {
    await migrationClient.query(migration.replaceAll('bookedradar_portal', schema));
    migrated = true;
  } catch (error) {
    try { await migrationClient.query('ROLLBACK'); } catch { migrationBroken = true; }
    throw error;
  } finally { migrationClient.release(migrationBroken); }
  const store = createPostgresPortalStore({ pool, schema });
  const resolveSession = createOpaqueSessionResolver({ store });
  const service = createCustomerPortalService({ store, resolveSession, allowedOrigins: [ORIGIN] });
  const request = async (method, path, body, token = tokenA, override = {}) => {
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${token}` };
    if (body !== undefined) {
      const session = await resolveSession({ headers });
      Object.assign(headers, { origin: ORIGIN, 'content-type': 'application/json', 'x-csrf-token': session?.csrfToken || 'invalid' });
    }
    return service({ method, url: `${API_PREFIX}${path}`, body, headers: { ...headers, ...override } });
  };
  async function reset() {
    await pool.query(`TRUNCATE ${s}.audit_events,${s}.notes,${s}.sessions,${s}.inquiries,${s}.memberships,${s}.tenants`);
    await pool.query(`INSERT INTO ${s}.tenants (id,name,active) VALUES ('tenant-a','Example A',true),('tenant-b','Example B',true)`);
    await pool.query(`INSERT INTO ${s}.memberships (tenant_id,id,user_id,name,role,active) VALUES
      ('tenant-a','member-a','user-a','Operator A','operator',true),
      ('tenant-a','member-a2','user-a2','Operator A2','operator',true),
      ('tenant-a','viewer-a','viewer-a','Viewer A','viewer',true),
      ('tenant-b','member-b','user-b','Operator B','operator',true)`);
    await pool.query(`INSERT INTO ${s}.inquiries (tenant_id,id,customer_name,subject,summary,source,received_at,updated_at)
      VALUES ('tenant-a','same-id','Customer A','Inquiry A','Synthetic A','phone',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
             ('tenant-b','same-id','Customer B','Inquiry B','Synthetic B','web',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
             ('tenant-b','only-b','Customer B','Private B','Synthetic B','web',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`);
    for (const [token, tenant, member, user, expired, revoked] of [
      [tokenA, 'tenant-a', 'member-a', 'user-a', false, false], [tokenB, 'tenant-b', 'member-b', 'user-b', false, false],
      [tokenExpired, 'tenant-a', 'member-a', 'user-a', true, false], [tokenRevoked, 'tenant-a', 'member-a', 'user-a', false, true],
    ]) await pool.query(`INSERT INTO ${s}.sessions (token_hash,tenant_id,member_id,user_id,created_at,expires_at,revoked_at)
      VALUES (decode($1,'hex'),$2,$3,$4,CURRENT_TIMESTAMP-INTERVAL '2 hours',CURRENT_TIMESTAMP+($5::int * INTERVAL '1 hour'),CASE WHEN $6 THEN CURRENT_TIMESTAMP ELSE NULL END)`, [hash(token), tenant, member, user, expired ? -1 : 1, revoked]);
  }
  async function run(name, body) { await t.test(name, async () => { await reset(); await body(); }); }

  await run('migration creates only normalized isolated tables with inactive-by-default new tenants', async () => {
    const tables = await pool.query('SELECT table_name FROM information_schema.tables WHERE table_schema=$1 ORDER BY table_name', [schema]);
    assert.deepEqual(tables.rows.map(row => row.table_name), ['audit_events', 'inquiries', 'memberships', 'notes', 'sessions', 'tenants']);
    await pool.query(`INSERT INTO ${s}.tenants (id,name) VALUES ('disabled-default','Disabled')`);
    assert.equal((await pool.query(`SELECT active FROM ${s}.tenants WHERE id='disabled-default'`)).rows[0].active, false);
  });
  await run('failed migration rolls back its new schema without leaving an aborted pooled transaction', async () => {
    const failedSchema = `bookedradar_portal_test_${randomBytes(6).toString('hex')}`;
    assert.equal((await pool.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [failedSchema])).rowCount, 0);
    const client = await pool.connect();
    let broken = false;
    try {
      const failingMigration = migration.replaceAll('bookedradar_portal', failedSchema).replace(/COMMIT;\s*$/, 'SELECT 1 / 0; COMMIT;');
      await assert.rejects(client.query(failingMigration), { code: '22012' });
      await client.query('ROLLBACK');
      assert.equal((await client.query('SELECT 1 AS healthy')).rows[0].healthy, 1);
      assert.equal((await pool.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [failedSchema])).rowCount, 0);
    } finally {
      try { await client.query('ROLLBACK'); } catch { broken = true; }
      client.release(broken);
      await assertDatabase();
      assert.match(failedSchema, /^bookedradar_portal_test_[a-f0-9]{12}$/);
      // Cleanup still targets only this generated schema if the failure assertion fails.
      await pool.query(`DROP SCHEMA IF EXISTS "${failedSchema}" CASCADE`);
    }
  });
  await run('session lookup validates hash, expiry, revocation, membership and tenant', async () => {
    assert.equal((await resolveSession({ headers: { cookie: `${SESSION_COOKIE_NAME}=${tokenA}` } })).tenantId, 'tenant-a');
    for (const token of [tokenExpired, tokenRevoked, Buffer.alloc(32, 99).toString('base64url')]) assert.equal(await resolveSession({ headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } }), null);
    assert.equal(await resolveSession({ headers: { authorization: `Bearer ${tokenA}` } }), null);
    await pool.query(`UPDATE ${s}.memberships SET active=false WHERE tenant_id='tenant-a' AND id='member-a'`);
    assert.equal(await resolveSession({ headers: { cookie: `${SESSION_COOKIE_NAME}=${tokenA}` } }), null);
    await pool.query(`UPDATE ${s}.memberships SET active=true WHERE tenant_id='tenant-a' AND id='member-a'`);
    await pool.query(`UPDATE ${s}.tenants SET active=false WHERE id='tenant-a'`);
    assert.equal(await resolveSession({ headers: { cookie: `${SESSION_COOKIE_NAME}=${tokenA}` } }), null);
  });
  await run('identical object IDs and linked reads stay inside the server-bound tenant', async () => {
    assert.equal((await request('GET', '/inquiries/same-id')).body.inquiry.customerName, 'Customer A');
    assert.equal((await request('GET', '/inquiries/same-id', undefined, tokenB)).body.inquiry.customerName, 'Customer B');
    assert.equal((await request('GET', '/inquiries/only-b')).status, 404);
    assert.equal((await request('GET', '/inquiries?tenant=tenant-b')).status, 400);
    assert.deepEqual((await request('GET', '/members')).body.members.map(member => member.id), ['member-a', 'member-a2']);
    assert.equal((await request('POST', '/inquiries/only-b/notes', { version: 1, text: 'Do not save' })).status, 404);
  });
  await run('composite foreign keys reject cross-tenant assignment, notes and session identity mismatch', async () => {
    await assert.rejects(pool.query(`UPDATE ${s}.inquiries SET assignee_id='member-b' WHERE tenant_id='tenant-a' AND id='same-id'`), { code: '23503' });
    await assert.rejects(pool.query(`INSERT INTO ${s}.notes (tenant_id,inquiry_id,id,author_id,text,created_at) VALUES ('tenant-a','same-id','cross-note','member-b','x',CURRENT_TIMESTAMP)`), { code: '23503' });
    await assert.rejects(pool.query(`UPDATE ${s}.sessions SET user_id='user-b' WHERE token_hash=decode($1,'hex')`, [hash(tokenA)]), { code: '23503' });
    assert.equal((await request('PATCH', '/inquiries/same-id', { version: 1, assigneeId: 'member-b' })).status, 400);
  });
  await run('status, assignment and note commit durably with exactly matching audits', async () => {
    assert.equal((await request('PATCH', '/inquiries/same-id', { version: 1, status: 'in_progress' })).status, 200);
    assert.equal((await request('PATCH', '/inquiries/same-id', { version: 2, assigneeId: 'member-a2' })).status, 200);
    const note = await request('POST', '/inquiries/same-id/notes', { version: 3, text: 'Synthetic internal note' });
    assert.equal(note.status, 201);
    const secondClient = await pool.connect();
    try {
      const row = (await secondClient.query(`SELECT status,assignee_id,version FROM ${s}.inquiries WHERE tenant_id='tenant-a' AND id='same-id'`)).rows[0];
      assert.deepEqual(row, { status: 'in_progress', assignee_id: 'member-a2', version: '4' });
      assert.equal((await secondClient.query(`SELECT count(*)::int AS count FROM ${s}.audit_events WHERE tenant_id='tenant-a'`)).rows[0].count, 3);
      assert.equal((await secondClient.query(`SELECT count(*)::int AS count FROM ${s}.notes WHERE tenant_id='tenant-a'`)).rows[0].count, 1);
      assert.equal((await store.getInquiry('tenant-b', 'same-id')).version, 1);
    } finally { secondClient.release(); }
    const reread = await request('GET', '/inquiries/same-id');
    assert.equal(reread.body.inquiry.notes[0].authorId, 'member-a');
    assert.equal(reread.body.inquiry.notes[0].text, 'Synthetic internal note');
  });
  await run('concurrent and stale writes serialize without lost updates', async () => {
    const pair = await Promise.all([
      request('PATCH', '/inquiries/same-id', { version: 1, status: 'in_progress' }),
      request('PATCH', '/inquiries/same-id', { version: 1, status: 'closed' }),
    ]);
    assert.deepEqual(pair.map(result => result.status).sort(), [200, 409]);
    assert.equal((await store.getInquiry('tenant-a', 'same-id')).version, 2);
    assert.equal((await pool.query(`SELECT count(*)::int AS count FROM ${s}.audit_events`)).rows[0].count, 1);
    assert.equal((await request('POST', '/inquiries/same-id/notes', { version: 1, text: 'Stale' })).status, 409);
  });
  await run('a blocked note writer reads committed child notes on a fresh snapshot and returns both notes', async () => {
    const firstWriter = await pool.connect();
    let waitingRequest;
    let writerCommitted = false;
    let waiterPidReady;
    const pidSignal = new Promise(resolve => { waiterPidReady = resolve; });
    const waitingPool = {
      query: pool.query.bind(pool),
      connect: async () => {
        const client = await pool.connect();
        try {
          const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
          waiterPidReady(pid);
          return client;
        } catch (error) { client.release(true); throw error; }
      },
    };
    const waitingStore = createPostgresPortalStore({ pool: waitingPool, schema });
    const waitingService = createCustomerPortalService({ store: waitingStore, resolveSession, allowedOrigins: [ORIGIN] });
    try {
      await firstWriter.query('BEGIN');
      const firstPid = (await firstWriter.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await firstWriter.query(`SELECT id FROM ${s}.inquiries WHERE tenant_id='tenant-a' AND id='same-id' FOR UPDATE`);
      const principal = await resolveSession({ headers: { cookie: `${SESSION_COOKIE_NAME}=${tokenA}` } });
      waitingRequest = waitingService({
        method: 'POST', url: `${API_PREFIX}/inquiries/same-id/notes`,
        headers: { cookie: `${SESSION_COOKIE_NAME}=${tokenA}`, origin: ORIGIN, 'content-type': 'application/json', 'x-csrf-token': principal.csrfToken },
        body: { version: 2, text: 'Second committed note' },
      });
      const waiterPid = await Promise.race([
        pidSignal,
        waitingRequest.then(result => { throw new Error(`Waiting request ended before taking a transaction connection: ${result.status}`); }),
      ]);
      // Synchronize on the actual server lock graph, never assume a sleep means
      // the second statement has started. Bound observation below the lock timeout.
      let blocked = false;
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const blockers = (await pool.query('SELECT pg_blocking_pids($1::int) AS pids', [waiterPid])).rows[0].pids;
        if (blockers.includes(firstPid)) { blocked = true; break; }
        await pool.query('SELECT pg_sleep(0.01)');
      }
      assert.equal(blocked, true, 'second transaction must be demonstrably blocked on the first parent lock');
      // The child is inserted only after the waiter statement's snapshot exists.
      await firstWriter.query(`INSERT INTO ${s}.notes (tenant_id,inquiry_id,id,author_id,text,created_at) VALUES ('tenant-a','same-id','first-note','member-a','First committed note',CURRENT_TIMESTAMP)`);
      await firstWriter.query(`UPDATE ${s}.inquiries SET version=2,updated_at=CURRENT_TIMESTAMP WHERE tenant_id='tenant-a' AND id='same-id' AND version=1`);
      await firstWriter.query(`INSERT INTO ${s}.audit_events (tenant_id,inquiry_id,id,actor_id,user_id,action,fields,previous_version,version,occurred_at,request_id)
        VALUES ('tenant-a','same-id','first-note-audit','member-a','user-a','inquiry.note_added',ARRAY['note'],1,2,CURRENT_TIMESTAMP,'00000000-0000-4000-8000-000000000003')`);
      await firstWriter.query('COMMIT'); writerCommitted = true;
      const response = await waitingRequest;
      assert.equal(response.status, 201);
      assert.equal(response.body.inquiry.version, 3);
      assert.deepEqual(response.body.inquiry.notes.map(note => note.text), ['First committed note', 'Second committed note']);
      const reread = await store.getInquiry('tenant-a', 'same-id');
      assert.equal(reread.version, 3);
      assert.deepEqual(reread.notes.map(note => note.text), ['First committed note', 'Second committed note']);
      assert.equal((await pool.query(`SELECT count(*)::int AS count FROM ${s}.audit_events WHERE tenant_id='tenant-a' AND inquiry_id='same-id'`)).rows[0].count, 2);
      assert.equal((await store.getInquiry('tenant-b', 'same-id')).version, 1);
    } finally {
      if (!writerCommitted) await firstWriter.query('ROLLBACK');
      firstWriter.release();
      if (waitingRequest) await waitingRequest;
    }
  });
  await run('database audit failure atomically rolls back inquiry and note writes', async () => {
    await pool.query(`ALTER TABLE ${s}.audit_events ADD CONSTRAINT reject_test_audit CHECK (false) NOT VALID`);
    try {
      assert.equal((await request('POST', '/inquiries/same-id/notes', { version: 1, text: 'Must roll back' })).status, 503);
      assert.equal((await store.getInquiry('tenant-a', 'same-id')).version, 1);
      assert.equal((await pool.query(`SELECT count(*)::int AS count FROM ${s}.notes`)).rows[0].count, 0);
      assert.equal((await pool.query(`SELECT count(*)::int AS count FROM ${s}.audit_events`)).rows[0].count, 0);
    } finally { await pool.query(`ALTER TABLE ${s}.audit_events DROP CONSTRAINT reject_test_audit`); }
  });
  await run('a missing audit cannot commit even when the store is invoked directly', async () => {
    await assert.rejects(store.transaction('tenant-a', async tx => {
      const row = await tx.getInquiry('same-id'); row.status = 'in_progress'; row.version++;
      await tx.saveInquiry(row);
    }), /atomic_audit_required/);
    assert.equal((await store.getInquiry('tenant-a', 'same-id')).version, 1);
  });
  await run('membership locks serialize revocation with an in-flight write', async () => {
    let locked; const lockedSignal = new Promise(resolve => { locked = resolve; });
    let continueWrite; const gate = new Promise(resolve => { continueWrite = resolve; });
    const writer = store.transaction('tenant-a', async tx => {
      const member = await tx.getMember('member-a'); locked(); await gate;
      const row = await tx.getInquiry('same-id'); const previousVersion = row.version;
      row.status = 'in_progress'; row.version++; row.updatedAt = new Date().toISOString();
      await tx.saveInquiry(row);
      await tx.appendAudit({ id: 'locked-audit', tenantId: 'tenant-a', inquiryId: 'same-id', actorId: member.id, userId: member.userId, action: 'inquiry.updated', fields: ['status'], previousVersion, version: row.version, occurredAt: row.updatedAt, requestId: '00000000-0000-4000-8000-000000000002' });
    });
    await lockedSignal;
    const revoker = await pool.connect();
    try {
      await revoker.query('BEGIN'); await revoker.query("SET LOCAL lock_timeout='200ms'");
      await assert.rejects(revoker.query(`UPDATE ${s}.memberships SET active=false WHERE tenant_id='tenant-a' AND id='member-a'`), { code: '55P03' });
      await revoker.query('ROLLBACK');
    } finally { revoker.release(); continueWrite(); }
    await writer;
    await pool.query(`UPDATE ${s}.memberships SET active=false WHERE tenant_id='tenant-a' AND id='member-a'`);
    assert.equal((await request('PATCH', '/inquiries/same-id', { version: 2, status: 'closed' })).status, 401);
  });
  await run('revocation committed after session resolution is rechecked before mutation', async () => {
    const principal = await resolveSession({ headers: { cookie: `${SESSION_COOKIE_NAME}=${tokenA}` } });
    const admitted = createCustomerPortalService({ store, resolveSession: async () => principal, allowedOrigins: [ORIGIN] });
    await pool.query(`UPDATE ${s}.memberships SET active=false WHERE tenant_id='tenant-a' AND id='member-a'`);
    const result = await admitted({ method: 'PATCH', url: `${API_PREFIX}/inquiries/same-id`, headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-csrf-token': principal.csrfToken }, body: { version: 1, status: 'closed' } });
    assert.equal(result.status, 403);
    assert.equal((await store.getInquiry('tenant-a', 'same-id')).version, 1);
  });
  await run('read-only role, invalid transition and invalid CSRF reject without persistent effects', async () => {
    assert.equal((await request('PATCH', '/inquiries/same-id', { version: 1, status: 'waiting' })).status, 409);
    assert.equal((await request('PATCH', '/inquiries/same-id', { version: 1, status: 'closed' }, tokenA, { 'x-csrf-token': 'wrong' })).status, 403);
    await pool.query(`UPDATE ${s}.memberships SET role='viewer' WHERE tenant_id='tenant-a' AND id='member-a'`);
    assert.equal((await request('GET', '/inquiries')).status, 200);
    assert.equal((await request('PATCH', '/inquiries/same-id', { version: 1, status: 'closed' })).status, 403);
    assert.equal((await store.getInquiry('tenant-a', 'same-id')).version, 1);
  });
  await run('notes are append-only and source/contact fields remain immutable at adapter boundary', async () => {
    await request('POST', '/inquiries/same-id/notes', { version: 1, text: 'Original note' });
    await assert.rejects(store.transaction('tenant-a', async tx => {
      const row = await tx.getInquiry('same-id'); row.notes[0].text = 'Altered'; row.version++;
      await tx.saveInquiry(row);
    }), /note_is_immutable/);
    await assert.rejects(store.transaction('tenant-a', async tx => {
      const row = await tx.getInquiry('same-id'); row.customerName = 'Altered'; row.status = 'closed'; row.version++;
      await tx.saveInquiry(row);
    }), /source_field_read_only/);
    assert.equal((await store.getInquiry('tenant-a', 'same-id')).notes[0].text, 'Original note');
  });
});
