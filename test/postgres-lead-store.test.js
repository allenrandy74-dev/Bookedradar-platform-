import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresLeadStore, exportPostgresLeads } from '../src/postgres-lead-store.js';

test('lead store rejects missing or conflicting tenant and invalid pagination', async () => {
  const pool = { query() { throw new Error('unexpected_query'); } };
  assert.throws(() => new PostgresLeadStore(pool, ''), /tenant_id_required/);
  const store = new PostgresLeadStore(pool, 'a');
  await assert.rejects(store.append({ tenant_id: 'b' }), /lead_tenant_conflict/);
  await assert.rejects(store.append({ tenant_id: 'a', tenantId: 'b' }), /lead_tenant_conflict/);
  await assert.rejects(store.append({}), /lead_tenant_conflict/);
  await assert.rejects(store.list({ afterId: '-1' }), /lead_cursor_invalid/);
  await assert.rejects(store.list({ afterId: '9223372036854775808' }), /lead_cursor_invalid/);
  await assert.rejects(store.list({ limit: 501 }), /lead_limit_invalid/);
  await assert.rejects(store.get('bad'), /lead_key_invalid/);
});

test('lead database outage propagates and recovery requires writer freeze', async () => {
  const store = new PostgresLeadStore({ async query() { throw new Error('offline'); } }, 'a');
  await assert.rejects(store.append({ tenant_id: 'a' }), /offline/);
  await assert.rejects(exportPostgresLeads({}, '/tmp/unused'), /writers_must_be_quiesced/);
});
