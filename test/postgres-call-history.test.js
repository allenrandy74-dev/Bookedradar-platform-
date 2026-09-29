import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresCallHistoryStore, exportPostgresCallHistory } from '../src/postgres-call-history.js';

test('history validates tenant and prevents structural edits through finish', async () => {
  assert.throws(() => new PostgresCallHistoryStore({}, ''), /tenant_id_required/);
  const store = new PostgresCallHistoryStore({}, 'a');
  assert.throws(() => store.start('call', { tenantId: 'b' }), /call_tenant_conflict/);
  assert.throws(() => store.finish('call', { transcript: [] }), /call_structural_patch_forbidden/);
  assert.throws(() => store.finish('call', { tenantId: 'b' }), /call_structural_patch_forbidden/);
  await assert.rejects(exportPostgresCallHistory({}, '/tmp/unused'), /writers_must_be_quiesced/);
});

test('history fails visibly when storage is unavailable', async () => {
  const pool = { async connect() { throw new Error('offline'); }, async query() { throw new Error('offline'); } };
  const store = new PostgresCallHistoryStore(pool, 'a');
  await assert.rejects(store.start('call'), /offline/);
  await assert.rejects(store.get('call'), /offline/);
});
