import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { PostgresLeadStore, exportPostgresLeads } from '../src/postgres-lead-store.js';
import { appendLead } from '../src/lead-store.js';
import { stableHash } from '../src/postgres-migration-audit.js';

const connectionString = process.env.POSTGRES_TEST_URL;
test('real Postgres: lead capture replay, isolation, pagination and recovery', { skip: !connectionString }, async t => {
  const url = new URL(connectionString);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.equal(url.pathname, '/bookedradar_test');
  const pool = new Pool({ connectionString, max: 10 });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'br-pg-leads-'));
  try {
    await pool.query('DROP SCHEMA IF EXISTS bookedradar CASCADE');
    await pool.query(await fs.readFile(new URL('../db/postgres-schema.sql', import.meta.url), 'utf8'));
    const a = new PostgresLeadStore(pool, 'tenant-a');
    const b = new PostgresLeadStore(pool, 'tenant-b');
    const lead = { tenant_id: 'tenant-a', call_id: 'synthetic', name: 'Test', captured_at: '2026-09-28T00:00:00Z', details: { urgency: 'routine', service: 'repair' } };
    await t.test('40 identical concurrent captures produce one record', async () => {
      const results = await Promise.all(Array.from({ length: 40 }, () => a.append(lead)));
      assert.equal(results.filter(r => !r.duplicate).length, 1);
      assert.equal(new Set(results.map(r => r.id)).size, 1);
      assert.deepEqual(await a.get(results[0].sourceKey), lead);
    });
    await t.test('migration-compatible key ignores object key order', async () => {
      const reordered = { details: { service: 'repair', urgency: 'routine' }, captured_at: lead.captured_at, name: lead.name, call_id: lead.call_id, tenant_id: lead.tenant_id };
      const result = await a.append(reordered);
      assert.equal(result.duplicate, true);
      assert.equal(result.sourceKey, stableHash(lead));
    });
    await t.test('tenant cannot read another capture or forge its ownership', async () => {
      assert.equal(await b.get(stableHash(lead)), null);
      await assert.rejects(b.append(lead), /lead_tenant_conflict/);
      assert.deepEqual(await b.list(), []);
      await b.append({ ...lead, tenant_id: 'tenant-b' });
    });
    await t.test('changed capture is preserved and pagination does not repeat rows', async () => {
      await a.append({ ...lead, name: 'Updated Test' });
      const first = await a.list({ limit: 1 });
      const second = await a.list({ afterId: first[0].id, limit: 1 });
      assert.equal(first[0].payload.name, 'Test');
      assert.equal(second[0].payload.name, 'Updated Test');
      assert.deepEqual(await a.list({ afterId: second[0].id }), []);
    });
    await t.test('invalid timestamp fails without a partially persisted capture', async () => {
      const invalid = { ...lead, captured_at: 'invalid-date' };
      await assert.rejects(a.append(invalid));
      assert.equal(await a.get(stableHash(invalid)), null);
    });
    await t.test('private JSONL export preserves all captures and accepts legacy appends', async () => {
      const result = await exportPostgresLeads(pool, root, { writersQuiesced: true });
      assert.equal(result.leads, 3);
      const rows = (await fs.readFile(result.file, 'utf8')).trim().split('\n').map(JSON.parse);
      assert.deepEqual(rows, [lead, { ...lead, tenant_id: 'tenant-b' }, { ...lead, name: 'Updated Test' }]);
      assert.equal((await fs.stat(result.file)).mode & 0o777, 0o600);
      await appendLead(result.file, { ...lead, name: 'Restored append' });
      assert.equal((await fs.readFile(result.file, 'utf8')).trim().split('\n').length, 4);
      const again = await exportPostgresLeads(pool, root, { writersQuiesced: true });
      assert.notEqual(again.file, result.file);
    });
  } finally {
    await pool.query('DROP SCHEMA IF EXISTS bookedradar CASCADE');
    await pool.end();
    await fs.rm(root, { recursive: true, force: true });
  }
});
