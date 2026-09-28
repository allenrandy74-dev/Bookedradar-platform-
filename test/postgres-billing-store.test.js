import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresBillingStore, exportPostgresBillingState } from '../src/billing/postgres-store.js';

test('Postgres billing rejects invalid mode and recovery without writer freeze', async () => {
  assert.throws(() => new PostgresBillingStore({}, { mode: 'production' }), /invalid_billing_mode/);
  await assert.rejects(exportPostgresBillingState({}, '/tmp/unused'), /writers_must_be_quiesced/);
});

test('billing connection failure does not invoke or retry the provider callback', async () => {
  let calls = 0;
  const store = new PostgresBillingStore({ async connect() { throw new Error('offline'); } });
  await assert.rejects(store.transaction(() => { calls++; }), /offline/);
  assert.equal(calls, 0);
});

test('billing callback failure rolls back and releases without an automatic retry', async () => {
  const queries = [];
  let calls = 0;
  let released = false;
  const client = {
    async query(sql) {
      queries.push(sql);
      return { rows: [{ payload: { version: 1, mode: 'test', accounts: {}, events: {} } }] };
    },
    release() { released = true; },
  };
  const store = new PostgresBillingStore({ connect: async () => client });
  await assert.rejects(store.transaction(() => { calls++; throw new Error('provider_failed'); }), /provider_failed/);
  assert.equal(calls, 1);
  assert.ok(queries.includes('ROLLBACK'));
  assert.ok(!queries.includes('COMMIT'));
  assert.equal(released, true);
});
