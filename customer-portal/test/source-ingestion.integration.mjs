import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { requireDisposablePostgres } from './disposable-postgres.mjs';
import { createPostgresSourceImporter } from '../server/source-importer.mjs';
import { createPostgresRecoverySourceReader } from '../server/source-reader.mjs';
import { createPostgresPortalStore } from '../server/postgres-store.mjs';
import { createCustomerPortalService, API_PREFIX } from '../server/api.mjs';

// This suite never accepts a remote DB, runtime credential or unacknowledged DB.
const config = requireDisposablePostgres();
const { Pool } = await import('pg');
const suffix = randomBytes(6).toString('hex');
const sourceSchema = `bookedradar_test_${suffix}`;
const portalSchema = `bookedradar_portal_test_${suffix}`;
const src = `"${sourceSchema}"`, dst = `"${portalSchema}"`;
const tenantId = 'tenant-a';
const T0 = '2026-10-01T09:00:00.000Z';
const T1 = '2026-10-01T10:00:00.000Z';

await test('disposable PostgreSQL source ingestion, fencing and audit', { timeout: 90000 }, async t => {
  const pool = new Pool({ connectionString: config.connectionString, max: 8, connectionTimeoutMillis: 3000, idleTimeoutMillis: 3000, application_name: 'bookedradar-disposable-ingestion-test' });
  const created = [];
  async function assertDatabase() {
    const row = (await pool.query("SELECT current_database() AS name,current_setting('server_version_num')::int AS version")).rows[0];
    assert.equal(row.name, config.database);
    assert.ok(row.version >= 180000);
  }
  t.after(async () => {
    try {
      await assertDatabase();
      for (const schema of created.reverse()) {
        assert.match(schema, /^bookedradar(?:_portal)?_test_[a-f0-9]{12}$/);
        await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
      }
    } finally { await pool.end(); }
  });
  await assertDatabase();
  for (const schema of [sourceSchema, portalSchema]) assert.equal((await pool.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [schema])).rowCount, 0);
  const sourceDdl = await readFile(new URL('../../db/postgres-schema.sql', import.meta.url), 'utf8');
  const portalDdl = await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8');
  const ingestionDdl = await readFile(new URL('../server/schema.source-ingestion.sql', import.meta.url), 'utf8');
  async function migrate(sql, schema) {
    const client = await pool.connect();
    let broken = false;
    try { await client.query(sql); created.push(schema); }
    catch (error) { try { await client.query('ROLLBACK'); } catch { broken = true; } throw error; }
    finally { client.release(broken); }
  }
  await migrate(`BEGIN;\n${sourceDdl.replaceAll('bookedradar', sourceSchema)}\nCOMMIT;`, sourceSchema);
  await migrate(portalDdl.replaceAll('bookedradar_portal', portalSchema), portalSchema);
  const migrationClient = await pool.connect();
  try { await migrationClient.query(ingestionDdl.replaceAll('bookedradar_portal', portalSchema)); }
  catch (error) { await migrationClient.query('ROLLBACK'); throw error; }
  finally { migrationClient.release(); }
  const importer = createPostgresSourceImporter({ pool, tenantId, sourceSchema, portalSchema, enabled: true });
  const visibleStore = createPostgresPortalStore({ pool, schema:portalSchema, sourceVisibility:'required' });
  const legacyStore = createPostgresPortalStore({ pool, schema:portalSchema });
  const origin='https://portal.example.test', csrf='synthetic-csrf-'.padEnd(43,'x');
  const principal=()=>({tenantId,tenantName:'Synthetic A',memberId:'operator-a',userId:'user-a',expiresAt:new Date(Date.now()+60000).toISOString(),sessionHash:'a'.repeat(64),csrfToken:csrf});
  const portalService=createCustomerPortalService({store:visibleStore,resolveSession:async()=>principal(),allowedOrigins:[origin]});
  const portalRequest=(method,path,body)=>({method,url:API_PREFIX+path,body,headers:{'x-csrf-token':csrf,...(body===undefined?{}:{origin,'content-type':'application/json'})}});
  function sourceRecords(id = 'opp-a', owner = tenantId) {
    const contactKey = `${owner}:fixture-${id}`, eventId = `receipt-${id}`;
    return {
      opportunity: { id, tenantId: owner, contactKey, sourceEventId: eventId, type: 'phone_lead', source: 'ai_phone_operator', serviceType: 'Synthetic inspection', createdAt: T1, updatedAt: T1, status: 'open', metadata: { notes: 'DO_NOT_IMPORT_RAW_INTERNAL_NOTES' } },
      contact: { tenantId: owner, contactKey, name: `Synthetic ${id}`, phone: '+15550100101', email: `${id}@example.test`, updatedAt: T1, secret: 'DO_NOT_IMPORT_PROVIDER_SECRET' },
      event: { id: eventId, tenantId: owner, type: 'phone_lead', contactKey, contact: { externalId: `fixture-${id}` }, occurredAt: T0, transcript: 'DO_NOT_IMPORT_TRANSCRIPT' },
    };
  }
  async function seed(id = 'opp-a', owner = tenantId) {
    const r = sourceRecords(id, owner);
    await pool.query(`INSERT INTO ${src}.recovery_contacts(contact_key,tenant_id,updated_at,payload) VALUES($1,$2,$3,$4)`, [r.contact.contactKey, owner, T1, r.contact]);
    await pool.query(`INSERT INTO ${src}.recovery_opportunities(opportunity_id,tenant_id,contact_key,status,created_at,updated_at,payload) VALUES($1,$2,$3,$4,$5,$5,$6)`, [id, owner, r.contact.contactKey, 'open', T1, r.opportunity]);
    await pool.query(`INSERT INTO ${src}.recovery_events(event_id,tenant_id,contact_key,occurred_at,payload) VALUES($1,$2,$3,$4,$5)`, [r.event.id, owner, r.contact.contactKey, T0, r.event]);
    return r;
  }
  async function reset() {
    await pool.query(`TRUNCATE ${dst}.source_visibility_audit,${dst}.source_visibility,${dst}.source_ingestion_audit,${dst}.source_links,${dst}.audit_events,${dst}.notes,${dst}.sessions,${dst}.inquiries,${dst}.memberships,${dst}.tenants`);
    await pool.query(`TRUNCATE ${src}.recovery_contacts,${src}.recovery_opportunities,${src}.recovery_events,${src}.recovery_actions,${src}.recovery_attribution`);
    await pool.query(`INSERT INTO ${dst}.tenants(id,name,active) VALUES('tenant-a','Synthetic A',true),('tenant-b','Synthetic B',true)`);
    await pool.query(`INSERT INTO ${dst}.memberships(tenant_id,id,user_id,name,role,active) VALUES('tenant-a','operator-a','user-a','Synthetic Operator','operator',true)`);
    await seed(); await seed('opp-b', 'tenant-b');
  }
  async function run(name, fn) { await t.test(name, async () => { await reset(); await fn(); }); }
  async function row(id = 'opp-a', owner = tenantId) { return (await pool.query(`SELECT * FROM ${dst}.inquiries WHERE tenant_id=$1 AND id=$2`, [owner, id])).rows[0]; }
  async function sourceSnapshot() {
    const result = {};
    for (const table of ['recovery_contacts','recovery_opportunities','recovery_events','recovery_actions','recovery_attribution']) {
      result[table] = (await pool.query(`SELECT to_jsonb(r) AS row FROM ${src}.${table} r ORDER BY to_jsonb(r)::text`)).rows;
    }
    return result;
  }
  async function waitForAdvisoryWait(pid) {
    const until = Date.now() + 3000;
    while (Date.now() < until) {
      const r = (await pool.query('SELECT wait_event_type,wait_event FROM pg_stat_activity WHERE pid=$1', [pid])).rows[0];
      if (r?.wait_event_type === 'Lock' && r?.wait_event === 'advisory') return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.fail('Expected a verified PostgreSQL advisory-lock wait, not a timing assumption');
  }

  await run('creates minimal inquiry, immutable source link and separate audit without source writes', async () => {
    const before = await sourceSnapshot();
    const reader = createPostgresRecoverySourceReader({ pool, tenantId, sourceSchema, enabled: true });
    const sourceView = await reader.readInquiry({ opportunityId: 'opp-a' });
    assert.doesNotMatch(JSON.stringify(sourceView), /DO_NOT_IMPORT|transcript|provider_secret/i);
    const result = await importer.importInquiry({ opportunityId: 'opp-a', expectedVersion: null });
    assert.equal(result.kind, 'create'); assert.equal(result.inquiryId, 'opp-a'); assert.equal(result.version, 1);
    const inquiry = await row();
    assert.equal(inquiry.customer_name, 'Synthetic opp-a'); assert.equal(inquiry.contact_email, 'opp-a@example.test');
    assert.equal(inquiry.summary, ''); assert.equal(inquiry.status, 'new'); assert.equal(inquiry.assignee_id, null); assert.equal(inquiry.version, '1');
    const link = (await pool.query(`SELECT * FROM ${dst}.source_links`)).rows[0];
    assert.equal(link.tenant_id, tenantId); assert.equal(link.inquiry_id, 'opp-a'); assert.equal(link.source_opportunity_id, 'opp-a');
    assert.equal(link.source_contact_key, 'tenant-a:fixture-opp-a'); assert.equal(link.source_event_id, 'receipt-opp-a');
    assert.match(link.source_fingerprint, /^[a-f0-9]{64}$/);
    const audit = (await pool.query(`SELECT * FROM ${dst}.source_ingestion_audit`)).rows;
    assert.equal(audit.length, 1); assert.equal(audit[0].service_actor, 'recovery_importer_v1'); assert.equal(audit[0].previous_version, null); assert.equal(audit[0].version, '1');
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${dst}.audit_events`)).rows[0].n, 0);
    assert.doesNotMatch(JSON.stringify({ result, inquiry, audit, link }), /DO_NOT_IMPORT|transcript|provider_secret/i);
    assert.deepEqual(await sourceSnapshot(), before);
  });

  await run('malformed payloads and subtrees are rejected without raw canaries crossing the source projection', async () => {
    const canary = 'FORBIDDEN_SYNTHETIC_RAW_SUBTREE_CANARY';
    const cases = [
      ['recovery_opportunities', () => [canary], 'invalid_source_payload'],
      ['recovery_contacts', () => canary, 'invalid_source_payload'],
      ['recovery_opportunities', () => ({...sourceRecords().opportunity,metadata:[canary]}), 'invalid_source_payload'],
      ['recovery_opportunities', () => ({...sourceRecords().opportunity,metadata:{synthetic:[canary]}}), 'invalid_source_metadata'],
      ['recovery_events', () => ({...sourceRecords().event,contact:canary}), 'invalid_source_payload'],
      ['recovery_contacts', () => ({...sourceRecords().contact,name:{secret:canary}}), 'invalid_source_payload'],
      ['recovery_contacts', () => ({...sourceRecords().contact,kind:{secret:canary}}), 'invalid_source_payload'],
      ['recovery_events', () => ({...sourceRecords().event,id:[canary]}), 'invalid_source_payload'],
      ['recovery_events', () => ({...sourceRecords().event,contact:{externalId:[canary]}}), 'invalid_event_contact'],
      ['recovery_opportunities', () => ({...sourceRecords().opportunity,serviceType:{secret:canary}}), 'invalid_source_payload'],
    ];
    for (const [table,malformed,code] of cases) {
      await reset();
      await importer.importInquiry({opportunityId:'opp-a',expectedVersion:null});
      await pool.query(`UPDATE ${src}.${table} SET payload=$1::jsonb WHERE tenant_id=$2`,[JSON.stringify(malformed()),tenantId]);
      const sourceResults=[];
      const watchingPool={connect:async()=>{
        const client=await pool.connect();return {query:async(sql,values)=>{
          const result=await client.query(sql,values);
          if(sql.includes(`FROM ${src}.`))sourceResults.push(...structuredClone(result.rows));
          return result;
        },release:client.release.bind(client)};
      }};
      const watchingImporter=createPostgresSourceImporter({pool:watchingPool,tenantId,sourceSchema,portalSchema,enabled:true});
      const result=await watchingImporter.importInquiry({opportunityId:'opp-a',expectedVersion:1});
      assert.equal(result.kind,'quarantined');assert.equal(result.reasonCode,code);
      assert.ok(sourceResults.length>0,'The instrumentation must observe actual source SELECT results');
      assert.equal(JSON.stringify(sourceResults).includes(canary),false,'Malformed forbidden contents must stay inside PostgreSQL');
      assert.ok(sourceResults.some(value=>value.payload===null || value.payload?.contact===null || value.payload?.metadata===null),'The SQL projection returns a fixed invalid sentinel');
      assert.equal(await visibleStore.getInquiry(tenantId,'opp-a'),undefined);
    }
  });

  await run('documented numeric epoch receipt time remains eligible under the SQL type gate',async()=>{
    const event=sourceRecords().event;event.occurredAt=Date.parse(T0);
    await pool.query(`UPDATE ${src}.recovery_events SET payload=$1 WHERE tenant_id=$2`,[event,tenantId]);
    const result=await importer.importInquiry({opportunityId:'opp-a',expectedVersion:null});
    assert.equal(result.kind,'create');
    assert.equal((await row()).received_at.toISOString(),T0);
    assert.equal((await visibleStore.getInquiry(tenantId,'opp-a')).receivedAt,T0);
  });

  await run('enumeration is tenant-bound, keyset-paginated and bounded', async () => {
    await seed('opp-c'); await seed('opp-d');
    const first = await importer.listOpportunityIds({ limit: 2 });
    assert.deepEqual(first.opportunityIds, ['opp-a','opp-c']); assert.equal(first.nextAfterId, 'opp-c');
    const next = await importer.listOpportunityIds({ afterId: first.nextAfterId, limit: 2 });
    assert.deepEqual(next.opportunityIds, ['opp-d']); assert.equal(next.nextAfterId, null);
    await assert.rejects(importer.listOpportunityIds({ limit: 1001 }), { code: 'invalid_source_limit' });
    await assert.rejects(importer.importInquiry({ opportunityId: 'opp-b', expectedVersion: null }), { code: 'source_opportunity_missing' });
    assert.equal(await row('opp-b', 'tenant-b'), undefined);
  });

  await run('refresh preserves human workflow, summary and notes; identical source is a no-op', async () => {
    await importer.importInquiry({ opportunityId: 'opp-a', expectedVersion: null });
    await pool.query(`UPDATE ${dst}.inquiries SET status='waiting',assignee_id='operator-a',summary='Synthetic human summary',version=2 WHERE tenant_id=$1 AND id='opp-a'`, [tenantId]);
    await pool.query(`INSERT INTO ${dst}.notes(tenant_id,inquiry_id,id,author_id,text,created_at) VALUES($1,'opp-a','note-a','operator-a','Synthetic owner note',CURRENT_TIMESTAMP)`, [tenantId]);
    const c = sourceRecords().contact; c.name = 'Synthetic updated contact';
    await pool.query(`UPDATE ${src}.recovery_contacts SET payload=$1 WHERE tenant_id=$2 AND contact_key=$3`, [c, tenantId, c.contactKey]);
    const before = await sourceSnapshot();
    const result = await importer.importInquiry({ opportunityId: 'opp-a', expectedVersion: 2 });
    assert.equal(result.kind, 'refresh'); assert.equal(result.version, 3);
    const updated = await row();
    assert.equal(updated.status, 'waiting'); assert.equal(updated.assignee_id, 'operator-a'); assert.equal(updated.summary, 'Synthetic human summary');
    assert.equal(updated.customer_name, c.name); assert.equal(updated.version, '3');
    assert.equal((await pool.query(`SELECT text FROM ${dst}.notes`)).rows[0].text, 'Synthetic owner note');
    const audits = (await pool.query(`SELECT * FROM ${dst}.source_ingestion_audit ORDER BY occurred_at`)).rows;
    assert.equal(audits.length, 2); assert.deepEqual(audits[1].fields, ['customerName']); assert.equal(audits[1].previous_version, '2');
    assert.equal((await importer.importInquiry({ opportunityId: 'opp-a', expectedVersion: 3 })).kind, 'unchanged');
    assert.equal((await row()).version, '3');
    assert.equal((await row()).updated_at.toISOString(), updated.updated_at.toISOString(), 'No-op refresh must not change human-visible update time');
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${dst}.source_ingestion_audit`)).rows[0].n, 2);
    assert.deepEqual(await sourceSnapshot(), before);
  });

  await run('stale expected version and duplicate creates cannot overwrite human work', async () => {
    await importer.importInquiry({ opportunityId: 'opp-a', expectedVersion: null });
    await pool.query(`UPDATE ${dst}.inquiries SET status='closed',version=2 WHERE tenant_id=$1 AND id='opp-a'`, [tenantId]);
    await assert.rejects(importer.importInquiry({ opportunityId: 'opp-a', expectedVersion: 1 }), { code: 'version_conflict' });
    await assert.rejects(importer.importInquiry({ opportunityId: 'opp-a', expectedVersion: null }), { code: 'version_conflict' });
    assert.equal((await row()).status, 'closed'); assert.equal((await row()).version, '2');
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${dst}.source_ingestion_audit`)).rows[0].n, 1);
  });

  await run('tenant-column conflicts, missing receipts and changed durable links fail closed', async () => {
    await pool.query(`UPDATE ${src}.recovery_contacts SET payload=jsonb_set(payload,'{tenantId}','"tenant-b"') WHERE tenant_id=$1`, [tenantId]);
    await assert.rejects(importer.importInquiry({ opportunityId: 'opp-a', expectedVersion: null }), { code: 'source_tenant_mismatch' });
    assert.equal(await row(), undefined);
    await pool.query(`UPDATE ${src}.recovery_contacts SET payload=$1 WHERE tenant_id=$2`, [sourceRecords().contact, tenantId]);
    await importer.importInquiry({ opportunityId: 'opp-a', expectedVersion: null });
    await pool.query(`DELETE FROM ${src}.recovery_events WHERE event_id='receipt-opp-a'`);
    const missing = await importer.importInquiry({ opportunityId: 'opp-a', expectedVersion: 1 });
    assert.equal(missing.kind, 'quarantined'); assert.equal(missing.reasonCode, 'source_event_missing');
    assert.equal((await row()).version, '2');
    assert.equal(await visibleStore.getInquiry(tenantId,'opp-a'), undefined);
    const changed = sourceRecords(); changed.event.id = 'replacement-receipt'; changed.opportunity.sourceEventId = changed.event.id;
    await pool.query(`INSERT INTO ${src}.recovery_events(event_id,tenant_id,contact_key,occurred_at,payload) VALUES($1,$2,$3,$4,$5)`, [changed.event.id, tenantId, changed.contact.contactKey, T0, changed.event]);
    await pool.query(`UPDATE ${src}.recovery_opportunities SET payload=$1 WHERE opportunity_id='opp-a'`, [changed.opportunity]);
    const rebound = await importer.importInquiry({ opportunityId: 'opp-a', expectedVersion: 2 });
    assert.equal(rebound.kind, 'quarantined'); assert.equal(rebound.reasonCode, 'source_binding_conflict');
    assert.equal((await row()).version, '2');
    assert.equal((await pool.query(`SELECT source_event_id FROM ${dst}.source_links`)).rows[0].source_event_id, 'receipt-opp-a');
  });

  await run('explicit synthetic lineage never becomes a real-eligible projection', async () => {
    const c = sourceRecords().contact; c.synthetic = true;
    await pool.query(`UPDATE ${src}.recovery_contacts SET payload=$1 WHERE tenant_id=$2`, [c, tenantId]);
    await assert.rejects(importer.importInquiry({ opportunityId: 'opp-a', expectedVersion: null }), { code: 'source_synthetic_excluded' });
    delete c.synthetic; await pool.query(`UPDATE ${src}.recovery_contacts SET payload=$1 WHERE tenant_id=$2`, [c, tenantId]);
    await pool.query(`INSERT INTO ${src}.recovery_actions(action_id,tenant_id,opportunity_id,contact_key,status,payload) VALUES('action-a',$1,'opp-a',$2,'pending',$3)`, [tenantId,c.contactKey,{ id:'action-a',tenantId,opportunityId:'opp-a',contactKey:c.contactKey,status:'pending',metadata:{synthetic:true} }]);
    await assert.rejects(importer.importInquiry({ opportunityId: 'opp-a', expectedVersion: null }), { code: 'source_synthetic_excluded' });
    assert.equal(await row(), undefined);
  });

  await run('an audit failure rolls back the inquiry and source link atomically', async () => {
    await pool.query(`CREATE FUNCTION ${dst}.reject_source_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$`);
    await pool.query(`CREATE TRIGGER reject_source_audit BEFORE INSERT ON ${dst}.source_ingestion_audit FOR EACH ROW EXECUTE FUNCTION ${dst}.reject_source_audit()`);
    try {
      await assert.rejects(importer.importInquiry({ opportunityId: 'opp-a', expectedVersion: null }), { code: 'source_database_error' });
      assert.equal(await row(), undefined);
      assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${dst}.source_links`)).rows[0].n, 0);
    } finally {
      await pool.query(`DROP TRIGGER reject_source_audit ON ${dst}.source_ingestion_audit`);
      await pool.query(`DROP FUNCTION ${dst}.reject_source_audit()`);
    }
    assert.equal((await importer.importInquiry({ opportunityId: 'opp-a', expectedVersion: null })).kind, 'create');
  });

  await run('a waiting importer reads source committed after the advisory-lock wait', async () => {
    const writer = await pool.connect();
    let workerPid;
    const trackedPool = { connect: async () => { const client = await pool.connect(); workerPid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid; return client; } };
    const waitingImporter = createPostgresSourceImporter({ pool: trackedPool, tenantId, sourceSchema, portalSchema, enabled: true });
    let pending, committed = false;
    try {
      await writer.query('BEGIN');
      await writer.query("SELECT pg_advisory_xact_lock(hashtext('br_recovery'),hashtext($1))", [tenantId]);
      const c = sourceRecords().contact; c.name = 'Synthetic committed while importer waited';
      await writer.query(`UPDATE ${src}.recovery_contacts SET payload=$1 WHERE tenant_id=$2`, [c,tenantId]);
      pending = waitingImporter.importInquiry({ opportunityId: 'opp-a', expectedVersion: null });
      pending.catch(()=>{});
      const until = Date.now()+1000;
      while (!workerPid && Date.now()<until) await new Promise(resolve=>setTimeout(resolve,10));
      assert.ok(workerPid); await waitForAdvisoryWait(workerPid);
      await writer.query('COMMIT'); committed = true;
      await pending;
      assert.equal((await row()).customer_name, c.name);
    } finally { if (!committed) await writer.query('ROLLBACK'); writer.release(); if (pending) await pending.catch(()=>{}); }
  });

  await run('simultaneous initial imports yield one durable create and one conflict', async () => {
    const pair = await Promise.allSettled([
      importer.importInquiry({ opportunityId: 'opp-a', expectedVersion: null }),
      importer.importInquiry({ opportunityId: 'opp-a', expectedVersion: null }),
    ]);
    assert.equal(pair.filter(x=>x.status==='fulfilled').length, 1);
    assert.equal(pair.filter(x=>x.status==='rejected').length, 1);
    assert.equal((await row()).version, '1');
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${dst}.source_links`)).rows[0].n, 1);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${dst}.source_ingestion_audit`)).rows[0].n, 1);
  });

  await run('failed refresh audit preserves prior projection, link checkpoint and human work', async () => {
    await importer.importInquiry({ opportunityId: 'opp-a', expectedVersion: null });
    const before = await row();
    const linkBefore = (await pool.query(`SELECT * FROM ${dst}.source_links`)).rows[0];
    const c = sourceRecords().contact; c.name = 'Synthetic failed-refresh candidate';
    await pool.query(`UPDATE ${src}.recovery_contacts SET payload=$1 WHERE tenant_id=$2`, [c,tenantId]);
    await pool.query(`CREATE FUNCTION ${dst}.reject_refresh_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic refresh audit failure'; END $$`);
    await pool.query(`CREATE TRIGGER reject_refresh_audit BEFORE INSERT ON ${dst}.source_ingestion_audit FOR EACH ROW EXECUTE FUNCTION ${dst}.reject_refresh_audit()`);
    try {
      await assert.rejects(importer.importInquiry({ opportunityId: 'opp-a', expectedVersion: 1 }), { code: 'source_database_error' });
      assert.deepEqual(await row(), before);
      assert.deepEqual((await pool.query(`SELECT * FROM ${dst}.source_links`)).rows[0], linkBefore);
      assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${dst}.source_ingestion_audit`)).rows[0].n, 1);
    } finally {
      await pool.query(`DROP TRIGGER reject_refresh_audit ON ${dst}.source_ingestion_audit`);
      await pool.query(`DROP FUNCTION ${dst}.reject_refresh_audit()`);
    }
  });

  await run('source fence remains held until projection and audit commit together', async () => {
    let atCommit, releaseCommit;
    const commitReached = new Promise(resolve => { atCommit = resolve; });
    const commitGate = new Promise(resolve => { releaseCommit = resolve; });
    const heldPool = { connect: async () => {
      const client = await pool.connect();
      return { query: async (sql,values) => {
        if (sql === 'COMMIT') { atCommit(); await commitGate; }
        return client.query(sql,values);
      }, release: client.release.bind(client) };
    } };
    const heldImporter = createPostgresSourceImporter({ pool: heldPool, tenantId, sourceSchema, portalSchema, enabled: true });
    const importing = heldImporter.importInquiry({ opportunityId:'opp-a',expectedVersion:null });
    const writer = await pool.connect();
    let locking;
    try {
      await Promise.race([commitReached, importing.then(() => { throw new Error('Importer completed without the held commit checkpoint'); })]);
      assert.equal(await row(), undefined, 'No partial portal insert is visible before import commit');
      const pid = (await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await writer.query('BEGIN');
      locking = writer.query("SELECT pg_advisory_xact_lock(hashtext('br_recovery'),hashtext($1))", [tenantId]);
      await waitForAdvisoryWait(pid);
      releaseCommit(); await importing; await locking;
      const c = sourceRecords().contact; c.name = 'Synthetic later source update';
      await writer.query(`UPDATE ${src}.recovery_contacts SET payload=$1 WHERE tenant_id=$2`, [c,tenantId]);
      await writer.query('COMMIT');
      assert.equal((await row()).customer_name, 'Synthetic opp-a');
      assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${dst}.source_ingestion_audit`)).rows[0].n, 1);
      await importer.importInquiry({ opportunityId:'opp-a',expectedVersion:1 });
      assert.equal((await row()).customer_name, c.name);
    } finally {
      releaseCommit(); await importing.catch(()=>{});
      if (locking) await locking.catch(()=>{});
      await writer.query('ROLLBACK'); writer.release();
    }
  });

  await run('an unfenced writer can bypass the cooperative fence: activation requires its exclusion', async () => {
    let atCommit, releaseCommit;
    const commitReached = new Promise(resolve => { atCommit = resolve; });
    const commitGate = new Promise(resolve => { releaseCommit = resolve; });
    const heldPool = { connect: async () => {
      const client = await pool.connect();
      return { query: async (sql,values) => {
        if (sql === 'COMMIT') { atCommit(); await commitGate; }
        return client.query(sql,values);
      }, release: client.release.bind(client) };
    } };
    const heldImporter = createPostgresSourceImporter({ pool: heldPool, tenantId, sourceSchema, portalSchema, enabled: true });
    const importing = heldImporter.importInquiry({ opportunityId:'opp-a',expectedVersion:null });
    importing.catch(()=>{});
    const writer = await pool.connect();
    let committed = false;
    try {
      await Promise.race([commitReached, importing.then(() => { throw new Error('Importer completed without the held commit checkpoint'); })]);
      await writer.query('BEGIN');
      await writer.query("SET LOCAL statement_timeout='1000ms'");
      // Intentionally no recovery advisory lock: this models the audited
      // maintenance/direct-SQL bypass, not an approved application writer.
      const c = sourceRecords().contact; c.name = 'Synthetic unfenced later update';
      await writer.query(`UPDATE ${src}.recovery_contacts SET payload=$1 WHERE tenant_id=$2`,[c,tenantId]);
      await writer.query('COMMIT'); committed = true;
      assert.equal((await pool.query(`SELECT payload->>'name' AS name FROM ${src}.recovery_contacts WHERE tenant_id=$1`,[tenantId])).rows[0].name,c.name);
      assert.equal(await row(),undefined,'Source write committed before the paused importer commit');
      releaseCommit(); await importing;
      assert.equal((await row()).customer_name,'Synthetic opp-a','Cooperative fencing does not prevent an unfenced stale projection');
      assert.equal((await visibleStore.listInquiries(tenantId)).length,1,'A lease does not repair an unfenced source race');
      await importer.importInquiry({opportunityId:'opp-a',expectedVersion:1});
      assert.equal((await row()).customer_name,c.name,'A later check observes the new source, without retroactively proving freshness');
    } finally {
      releaseCommit(); await importing.catch(()=>{});
      if(!committed) await writer.query('ROLLBACK');
      writer.release();
    }
  });

  await run('a blocked importer rejects a human edit committed while it waits', async () => {
    await importer.importInquiry({ opportunityId:'opp-a',expectedVersion:null });
    const c = sourceRecords().contact; c.name = 'Synthetic pending refresh';
    await pool.query(`UPDATE ${src}.recovery_contacts SET payload=$1 WHERE tenant_id=$2`, [c,tenantId]);
    const human = await pool.connect();
    let workerPid, pending, committed = false;
    const trackedPool = { connect: async () => { const client=await pool.connect(); workerPid=(await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid; return client; } };
    const waitingImporter = createPostgresSourceImporter({pool:trackedPool,tenantId,sourceSchema,portalSchema,enabled:true});
    try {
      await human.query('BEGIN');
      await human.query(`SELECT id FROM ${dst}.inquiries WHERE tenant_id=$1 AND id='opp-a' FOR UPDATE`,[tenantId]);
      await human.query(`UPDATE ${dst}.inquiries SET status='waiting',version=2,updated_at=clock_timestamp() WHERE tenant_id=$1 AND id='opp-a'`,[tenantId]);
      await human.query(`INSERT INTO ${dst}.notes(tenant_id,inquiry_id,id,author_id,text,created_at) VALUES($1,'opp-a','concurrent-note','operator-a','Synthetic concurrent note',clock_timestamp())`,[tenantId]);
      pending = waitingImporter.importInquiry({opportunityId:'opp-a',expectedVersion:1});
      // Attach rejection handler immediately while retaining the original promise.
      pending.catch(()=>{});
      const until=Date.now()+3000; let blocked=false;
      while(Date.now()<until) {
        if(workerPid) {
          const state=(await pool.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[workerPid])).rows[0];
          if(state?.wait_event_type==='Lock') { blocked=true; break; }
        }
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      assert.equal(blocked,true,'Importer must actually wait for the human parent lock');
      await human.query('COMMIT'); committed=true;
      await assert.rejects(pending,{code:'version_conflict'});
      const after = await row();
      assert.equal(after.status,'waiting'); assert.equal(after.version,'2'); assert.equal(after.customer_name,'Synthetic opp-a');
      assert.equal((await pool.query(`SELECT text FROM ${dst}.notes`)).rows[0].text,'Synthetic concurrent note');
      await importer.importInquiry({opportunityId:'opp-a',expectedVersion:2});
      const refreshed=await row();
      assert.equal(refreshed.version,'3'); assert.equal(refreshed.status,'waiting'); assert.equal(refreshed.customer_name,c.name);
      assert.ok(refreshed.updated_at.getTime()>=after.updated_at.getTime());
      assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${dst}.notes`)).rows[0].n,1);
    } finally { if(!committed) await human.query('ROLLBACK'); human.release(); if(pending) await pending.catch(()=>{}); }
  });

  await run('lost commit acknowledgement reports uncertainty instead of false failure or success', async () => {
    let discarded = false;
    const uncertainPool = { connect: async () => {
      const client = await pool.connect();
      return { query: async (sql,values) => {
        const result = await client.query(sql,values);
        if (sql === 'COMMIT') throw new Error('DO_NOT_EXPOSE_COMMIT_DRIVER_DETAILS');
        return result;
      }, release: broken => { discarded = broken; client.release(broken); } };
    } };
    const uncertainImporter = createPostgresSourceImporter({pool:uncertainPool,tenantId,sourceSchema,portalSchema,enabled:true});
    await assert.rejects(uncertainImporter.importInquiry({opportunityId:'opp-a',expectedVersion:null}), error => {
      assert.equal(error.code,'source_commit_uncertain'); assert.equal(error.message,'source_commit_uncertain');
      assert.doesNotMatch(JSON.stringify(error),/DO_NOT_EXPOSE/); return true;
    });
    assert.equal(discarded,true);
    // Read-only reconciliation proves the commit happened; do not blindly retry.
    assert.equal((await row()).version,'1');
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${dst}.source_links`)).rows[0].n,1);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${dst}.source_ingestion_audit`)).rows[0].n,1);
  });

  await run('over-limit lineage is rejected instead of silently truncated', async () => {
    const c=sourceRecords().contact;
    for(let i=0;i<101;i++) {
      const id=`action-bound-${String(i).padStart(3,'0')}`;
      await pool.query(`INSERT INTO ${src}.recovery_actions(action_id,tenant_id,opportunity_id,contact_key,status,payload) VALUES($1,$2,'opp-a',$3,'pending',$4)`,[id,tenantId,c.contactKey,{id,tenantId,opportunityId:'opp-a',contactKey:c.contactKey,status:'pending'}]);
    }
    await assert.rejects(importer.importInquiry({opportunityId:'opp-a',expectedVersion:null}),{code:'source_lineage_limit_exceeded'});
    assert.equal(await row(),undefined);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${dst}.source_links`)).rows[0].n,0);
  });

  await run('required visibility filters before limit and denies unlinked or cross-tenant details',async()=>{
    await importer.importInquiry({opportunityId:'opp-a',expectedVersion:null});
    await pool.query(`INSERT INTO ${dst}.inquiries(tenant_id,id,customer_name,subject,summary,source,received_at,updated_at) VALUES($1,'unlinked','Synthetic unlinked','Fixture','','test',clock_timestamp(),clock_timestamp())`,[tenantId]);
    const list=await visibleStore.listInquiries(tenantId,1);
    assert.deepEqual(list.map(i=>i.id),['opp-a']);
    assert.equal(await visibleStore.getInquiry(tenantId,'unlinked'),undefined);
    assert.equal(await visibleStore.getInquiry('tenant-b','opp-a'),undefined);
    assert.equal((await legacyStore.listInquiries(tenantId,1))[0].id,'unlinked','Default synthetic mode is unchanged');
    const detail=await portalService(portalRequest('GET','/inquiries/opp-a'));
    assert.equal(detail.status,200);
    assert.doesNotMatch(JSON.stringify(detail.body),/reasonCode|reason_code|valid_until|checked_at|source_fingerprint|source_visibility/);
  });

  await run('known ineligibility hides detail and notes atomically and invalidates old drafts on restore',async()=>{
    await importer.importInquiry({opportunityId:'opp-a',expectedVersion:null});
    await pool.query(`INSERT INTO ${dst}.notes(tenant_id,inquiry_id,id,author_id,text,created_at) VALUES($1,'opp-a','retained-note','operator-a','Synthetic retained note',clock_timestamp())`,[tenantId]);
    await pool.query(`UPDATE ${dst}.inquiries SET status='waiting',assignee_id='operator-a',version=2 WHERE tenant_id=$1 AND id='opp-a'`,[tenantId]);
    const c=sourceRecords().contact;c.synthetic=true;
    await pool.query(`UPDATE ${src}.recovery_contacts SET payload=$1 WHERE tenant_id=$2`,[c,tenantId]);
    const quarantined=await importer.importInquiry({opportunityId:'opp-a',expectedVersion:1});
    assert.equal(quarantined.kind,'quarantined');assert.equal(quarantined.version,3,'Safety quarantine must commit even when workflow expectedVersion is stale');
    assert.equal(await visibleStore.getInquiry(tenantId,'opp-a'),undefined);
    assert.deepEqual(await visibleStore.listInquiries(tenantId),[]);
    assert.equal((await portalService(portalRequest('GET','/inquiries/opp-a'))).status,404);
    assert.equal((await portalService(portalRequest('POST','/inquiries/opp-a/notes',{version:3,text:'Synthetic hidden write'}))).status,404);
    const hidden=await row();assert.equal(hidden.status,'waiting');assert.equal(hidden.assignee_id,'operator-a');
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${dst}.notes`)).rows[0].n,1);
    const firstAudits=(await pool.query(`SELECT count(*)::int AS n FROM ${dst}.source_visibility_audit`)).rows[0].n;
    await importer.importInquiry({opportunityId:'opp-a',expectedVersion:3});
    assert.equal((await row()).version,'3');
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${dst}.source_visibility_audit`)).rows[0].n,firstAudits,'Repeated same quarantine creates no duplicate transition');
    delete c.synthetic;await pool.query(`UPDATE ${src}.recovery_contacts SET payload=$1 WHERE tenant_id=$2`,[c,tenantId]);
    await assert.rejects(importer.importInquiry({opportunityId:'opp-a',expectedVersion:2}),{code:'version_conflict'});
    assert.equal(await visibleStore.getInquiry(tenantId,'opp-a'),undefined,'Stale eligible refresh cannot restore visibility');
    const restored=await importer.importInquiry({opportunityId:'opp-a',expectedVersion:3});
    assert.equal(restored.kind,'restored');assert.equal(restored.version,4);
    const shown=await visibleStore.getInquiry(tenantId,'opp-a');assert.equal(shown.status,'waiting');assert.equal(shown.assigneeId,'operator-a');assert.equal(shown.notes[0].text,'Synthetic retained note');
    assert.equal((await portalService(portalRequest('PATCH','/inquiries/opp-a',{version:2,status:'in_progress'}))).status,409,'Pre-quarantine draft must not replay after restoration');
    const transitions=(await pool.query(`SELECT state,previous_version,version FROM ${dst}.source_visibility_audit ORDER BY revision`)).rows;
    assert.deepEqual(transitions.map(a=>[a.state,a.previous_version,a.version]),[['active',null,'1'],['quarantined','2','3'],['active','3','4']]);
  });

  await run('restoration with changed mapped fields increments inquiry version exactly once',async()=>{
    await importer.importInquiry({opportunityId:'opp-a',expectedVersion:null});
    const c=sourceRecords().contact;c.synthetic=true;
    await pool.query(`UPDATE ${src}.recovery_contacts SET payload=$1 WHERE tenant_id=$2`,[c,tenantId]);
    await importer.importInquiry({opportunityId:'opp-a',expectedVersion:1});
    delete c.synthetic;c.name='Synthetic restored update';await pool.query(`UPDATE ${src}.recovery_contacts SET payload=$1 WHERE tenant_id=$2`,[c,tenantId]);
    const result=await importer.importInquiry({opportunityId:'opp-a',expectedVersion:2});
    assert.equal(result.kind,'restored');assert.equal(result.version,3);
    assert.equal((await row()).customer_name,c.name);
    assert.equal((await pool.query(`SELECT version FROM ${dst}.source_ingestion_audit ORDER BY version DESC LIMIT 1`)).rows[0].version,'3');
  });

  await run('lease expiry, future checks, fingerprint mismatch and missing visibility fail closed',async()=>{
    await importer.importInquiry({opportunityId:'opp-a',expectedVersion:null});
    assert.ok(await visibleStore.getInquiry(tenantId,'opp-a'));
    await pool.query(`UPDATE ${dst}.source_visibility SET checked_at=clock_timestamp()-INTERVAL '2 seconds',valid_until=clock_timestamp()-INTERVAL '1 second' WHERE tenant_id=$1`,[tenantId]);
    assert.equal(await visibleStore.getInquiry(tenantId,'opp-a'),undefined);assert.deepEqual(await visibleStore.listInquiries(tenantId),[]);
    assert.equal((await row()).version,'1','Passive expiry is not a workflow transition');
    await importer.importInquiry({opportunityId:'opp-a',expectedVersion:1});
    await pool.query(`UPDATE ${dst}.source_visibility SET checked_at=clock_timestamp()+INTERVAL '10 seconds',valid_until=clock_timestamp()+INTERVAL '11 seconds' WHERE tenant_id=$1`,[tenantId]);
    assert.equal(await visibleStore.getInquiry(tenantId,'opp-a'),undefined);
    await pool.query(`UPDATE ${dst}.source_visibility SET checked_at=clock_timestamp(),valid_until=clock_timestamp()+INTERVAL '10 seconds',source_fingerprint=repeat('a',64) WHERE tenant_id=$1`,[tenantId]);
    assert.equal(await visibleStore.getInquiry(tenantId,'opp-a'),undefined);
    await pool.query(`DELETE FROM ${dst}.source_visibility_audit WHERE tenant_id=$1`,[tenantId]);
    await pool.query(`DELETE FROM ${dst}.source_visibility WHERE tenant_id=$1`,[tenantId]);
    assert.equal(await visibleStore.getInquiry(tenantId,'opp-a'),undefined);
  });

  await run('visibility schema rejects oversized leases and original source links cannot be rebound',async()=>{
    await importer.importInquiry({opportunityId:'opp-a',expectedVersion:null});
    await assert.rejects(pool.query(`UPDATE ${dst}.source_visibility SET valid_until=checked_at+INTERVAL '61 seconds' WHERE tenant_id=$1`,[tenantId]),{code:'23514'});
    await assert.rejects(pool.query(`UPDATE ${dst}.source_visibility SET reason_code='source_event_missing' WHERE tenant_id=$1`,[tenantId]),{code:'23514'});
    await assert.rejects(pool.query(`UPDATE ${dst}.source_links SET source_event_id='replacement' WHERE tenant_id=$1`,[tenantId]));
    assert.equal((await pool.query(`SELECT source_event_id FROM ${dst}.source_links`)).rows[0].source_event_id,'receipt-opp-a');
  });

  await run('quarantine audit failure rolls back transition and never reports safety success',async()=>{
    await importer.importInquiry({opportunityId:'opp-a',expectedVersion:null});
    const before=await row(),visibilityBefore=(await pool.query(`SELECT * FROM ${dst}.source_visibility`)).rows[0];
    const c=sourceRecords().contact;c.synthetic=true;await pool.query(`UPDATE ${src}.recovery_contacts SET payload=$1 WHERE tenant_id=$2`,[c,tenantId]);
    await pool.query(`CREATE FUNCTION ${dst}.reject_visibility_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic visibility audit failure'; END $$`);
    await pool.query(`CREATE TRIGGER reject_visibility_audit BEFORE INSERT ON ${dst}.source_visibility_audit FOR EACH ROW EXECUTE FUNCTION ${dst}.reject_visibility_audit()`);
    try {
      await assert.rejects(importer.importInquiry({opportunityId:'opp-a',expectedVersion:1}),{code:'source_database_error'});
      assert.deepEqual(await row(),before);assert.deepEqual((await pool.query(`SELECT * FROM ${dst}.source_visibility`)).rows[0],visibilityBefore);
      assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${dst}.source_visibility_audit`)).rows[0].n,1);
    } finally {await pool.query(`DROP TRIGGER reject_visibility_audit ON ${dst}.source_visibility_audit`);await pool.query(`DROP FUNCTION ${dst}.reject_visibility_audit()`);}
    assert.equal((await importer.importInquiry({opportunityId:'opp-a',expectedVersion:1})).kind,'quarantined');
  });

  await run('an admitted API mutation cannot save after quarantine commits',async()=>{
    await importer.importInquiry({opportunityId:'opp-a',expectedVersion:null});
    let admitted,continueRequest;
    const firstMember=new Promise(resolve=>{admitted=resolve;});const proceed=new Promise(resolve=>{continueRequest=resolve;});
    let first=true;
    const racingStore={...visibleStore,getMember:async(...args)=>{const result=await visibleStore.getMember(...args);if(first){first=false;admitted();await proceed;}return result;}};
    const service=createCustomerPortalService({store:racingStore,resolveSession:async()=>principal(),allowedOrigins:[origin]});
    const pending=service(portalRequest('POST','/inquiries/opp-a/notes',{version:1,text:'Synthetic race must not save'}));
    try {
      await firstMember;
      const c=sourceRecords().contact;c.synthetic=true;await pool.query(`UPDATE ${src}.recovery_contacts SET payload=$1 WHERE tenant_id=$2`,[c,tenantId]);
      assert.equal((await importer.importInquiry({opportunityId:'opp-a',expectedVersion:1})).kind,'quarantined');
      continueRequest();assert.equal((await pending).status,404);
      assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${dst}.notes`)).rows[0].n,0);
      assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${dst}.audit_events`)).rows[0].n,0);
    } finally {continueRequest();await pending;}
  });

  await run('lease expiry after transactional read rejects an update and rolls back',async()=>{
    const short=createPostgresSourceImporter({pool,tenantId,sourceSchema,portalSchema,enabled:true,visibilityLeaseMs:1000});
    await short.importInquiry({opportunityId:'opp-a',expectedVersion:null});
    await assert.rejects(visibleStore.transaction(tenantId,async tx=>{
      const inquiry=await tx.getInquiry('opp-a');assert.ok(inquiry);
      await pool.query('SELECT pg_sleep(1.1)');
      inquiry.status='closed';inquiry.version++;inquiry.updatedAt=new Date().toISOString();
      await tx.saveInquiry(inquiry);
    }),/source_visibility_or_version_conflict/);
    assert.equal((await row()).status,'new');assert.equal((await row()).version,'1');
  });

  await run('lease expiry between parent update and note insertion rolls back both',async()=>{
    const short=createPostgresSourceImporter({pool,tenantId,sourceSchema,portalSchema,enabled:true,visibilityLeaseMs:1000});
    await short.importInquiry({opportunityId:'opp-a',expectedVersion:null});
    const delayingPool={query:pool.query.bind(pool),connect:async()=>{
      const client=await pool.connect();return {query:async(sql,values)=>{
        const result=await client.query(sql,values);
        if(sql.startsWith(`UPDATE ${dst}.inquiries i SET`))await client.query('SELECT pg_sleep(1.1)');
        return result;
      },release:client.release.bind(client)};
    }};
    const store=createPostgresPortalStore({pool:delayingPool,schema:portalSchema,sourceVisibility:'required'});
    await assert.rejects(store.transaction(tenantId,async tx=>{
      const inquiry=await tx.getInquiry('opp-a');assert.ok(inquiry);inquiry.version++;inquiry.updatedAt=new Date().toISOString();
      inquiry.notes.push({id:'expired-note',tenantId,inquiryId:'opp-a',authorId:'operator-a',text:'Synthetic expired note',createdAt:inquiry.updatedAt});
      await tx.saveInquiry(inquiry);
    }),/source_visibility_or_version_conflict/);
    assert.equal((await row()).version,'1');assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${dst}.notes`)).rows[0].n,0);
  });
});
