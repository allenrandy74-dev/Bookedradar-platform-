import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { PostgresBillingStore, exportPostgresBillingState } from '../src/billing/postgres-store.js';
import { BillingStore } from '../src/billing/store.js';
import { BillingService } from '../src/billing/service.js';

const connectionString = process.env.POSTGRES_TEST_URL;
test('real Postgres: billing transactions, quota, deduplication and recovery', { skip: !connectionString }, async t => {
  const url = new URL(connectionString);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.equal(url.pathname, '/bookedradar_test');
  const pool = new Pool({ connectionString, max: 10 });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'br-pg-billing-'));
  try {
    await pool.query('DROP SCHEMA IF EXISTS bookedradar CASCADE');
    await pool.query(await fs.readFile(new URL('../db/postgres-schema.sql', import.meta.url), 'utf8'));
    const store = new PostgresBillingStore(pool);
    await store.load();
    await t.test('independent store instances serialize increments without lost writes', async () => {
      await Promise.all(Array.from({ length: 30 }, () => new PostgresBillingStore(pool).transaction(data => {
        data.counter = (data.counter || 0) + 1;
      })));
      assert.equal(await store.transaction(data => data.counter), 30);
    });
    await t.test('test and live state never share records', async () => {
      const live = new PostgresBillingStore(pool, { mode: 'live' });
      assert.equal(await live.transaction(data => data.counter), undefined);
      await live.transaction(data => { data.counter = 100; });
      assert.equal(await store.transaction(data => data.counter), 30);
    });
    await t.test('failed and invalid transactions do not commit, and next request succeeds', async () => {
      await assert.rejects(store.transaction(data => { data.counter = 999; throw new Error('synthetic_failure'); }), /synthetic_failure/);
      await assert.rejects(store.transaction(data => { data.mode = 'live'; }), /invalid_billing_store/);
      assert.equal(await store.transaction(data => data.counter), 30);
    });
    await t.test('simultaneous repeated event mutations apply once', async () => {
      const results = await Promise.all(Array.from({ length: 20 }, () => new PostgresBillingStore(pool).transaction(data => {
        if (data.events.synthetic) return false;
        data.events.synthetic = { processed: true };
        data.counter++;
        return true;
      })));
      assert.equal(results.filter(Boolean).length, 1);
      assert.equal(await store.transaction(data => data.counter), 31);
    });
    await t.test('existing BillingService enforces five founding partners across concurrent stores', async () => {
      let providerCalls = 0;
      // Pure local stub: never invokes Stripe or a live payment endpoint.
      const stripe = { customers: { async create() { providerCalls++; return { id: `cus_synthetic_${providerCalls}`, livemode: false }; } } };
      const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => {
        const service = new BillingService({ stripe, store: new PostgresBillingStore(pool), priceId: 'price_synthetic', tenantExists: () => true });
        return service.enroll({ tenantId: `tenant_${i}`, qualified: true, agreementAccepted: true });
      }));
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 5);
      for (const r of results.filter(r => r.status === 'rejected')) assert.match(r.reason.message, /founding_partner_limit_reached/);
      assert.equal(providerCalls, 5);
      const numbers = await store.transaction(data => Object.values(data.accounts).map(a => a.foundingPartnerNumber).sort());
      assert.deepEqual(numbers, [1, 2, 3, 4, 5]);
    });
    await t.test('component export reloads through the existing billing JSON store', async () => {
      const result = await exportPostgresBillingState(pool, root, { writersQuiesced: true });
      assert.equal(result.accounts, 5);
      const json = await new BillingStore(result.file).load();
      assert.deepEqual(json.data, await store.transaction(data => data));
      assert.equal((await fs.stat(result.file)).mode & 0o777, 0o600);
      const another = await exportPostgresBillingState(pool, root, { writersQuiesced: true });
      assert.notEqual(another.file, result.file);
    });
    await t.test('duplicate enrollment returns existing account without another provider operation', async () => {
      const account = await store.transaction(data => Object.values(data.accounts)[0]);
      const stripe = { customers: { async create() { throw new Error('unexpected_provider_call'); } } };
      const results = await Promise.all(Array.from({ length: 10 }, () => {
        const service = new BillingService({ stripe, store: new PostgresBillingStore(pool), priceId: 'price_synthetic', tenantExists: () => true });
        return service.enroll({ tenantId: account.tenantId, qualified: true, agreementAccepted: true });
      }));
      for (const result of results) assert.deepEqual(result, account);
    });
  } finally {
    await pool.query('DROP SCHEMA IF EXISTS bookedradar CASCADE');
    await pool.end();
    await fs.rm(root, { recursive: true, force: true });
  }
});
