import test from 'node:test';
import assert from 'node:assert/strict';
import { postgresLabConfig } from '../src/postgres-server-stores.js';
test('server storage defaults to JSON and refuses production activation',()=>{
  assert.equal(postgresLabConfig({}),null);
  assert.throws(()=>postgresLabConfig({BOOKEDRADAR_STORAGE_BACKEND:'postgres'}),/storage_backend_not_released/);
  const env={BOOKEDRADAR_STORAGE_BACKEND:'postgres_lab',DATABASE_URL:'postgres://test:synthetic@127.0.0.1/bookedradar_test'};
  assert.ok(postgresLabConfig(env));
  assert.throws(()=>postgresLabConfig({...env,DATABASE_URL:'postgres://test:synthetic@internal.render/bookedradar'}),/disposable_database/);
  assert.throws(()=>postgresLabConfig({...env,DISPATCH_ENABLED:'true'}),/providers_disabled/);
  assert.throws(()=>postgresLabConfig({...env,OPENAI_API_KEY:'synthetic'}),/providers_disabled/);
  assert.throws(()=>postgresLabConfig({...env,CRM_SMOKE_TEST_ON_STARTUP:'true'}),/providers_disabled/);
});
