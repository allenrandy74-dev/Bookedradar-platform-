import test from 'node:test';
import assert from 'node:assert/strict';
import { readPostgresSnapshot, exportPostgresPlatform } from '../src/postgres-full-export.js';
import { PostgresRecoveryStore } from '../src/postgres-recovery-store.js';
import { PostgresWebChatStore,PostgresTransferStore,PostgresGrowthMetricsStore } from '../src/postgres-aux-stores.js';
test('remaining adapters validate tenancy, revisions and export freeze',async()=>{
  assert.throws(()=>new PostgresRecoveryStore({},''),/tenant_id_required/);
  assert.throws(()=>new PostgresWebChatStore({},'t1').update('s',{}),/chat_revision_required/);
  assert.throws(()=>new PostgresTransferStore({},'t1').patchCall('s',{tenantId:'t2'}),/transfer_patch_invalid/);
  assert.throws(()=>new PostgresRecoveryStore({},'t1').ingest({}, {tenantId:'t2'}),/recovery_tenant_conflict/);
  await assert.rejects(new PostgresGrowthMetricsStore({}).record({event:'invalid'}),/unsupported_event/);
  await assert.rejects(exportPostgresPlatform({},'/tmp/unused'),/writers_must_be_quiesced/);
});


test('platform snapshot fails closed before reading business rows when lab ops state cannot be represented', async () => {
  for (const rows of [[{ has_ops_state: true }], []]) {
    const queries = [];
    await assert.rejects(readPostgresSnapshot({ query: async sql => { queries.push(sql); return { rows }; } }), /all_table_backup_for_ops_state/);
    assert.equal(queries.length, 1); assert.match(queries[0], /ops_notifications/);
  }
});
