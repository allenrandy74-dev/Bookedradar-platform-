import test from 'node:test';
import assert from 'node:assert/strict';
import { postgresBackendConfig, postgresLabConfig } from '../src/postgres-server-stores.js';

const fingerprint='4de6c957e16a247a73cbff78cd2ce175044995b7e83fd0aecd1940bd120bd75e';

test('server storage defaults to JSON and production activation remains fail closed',()=>{
  assert.equal(postgresBackendConfig({}),null);
  assert.throws(
    ()=>postgresBackendConfig({BOOKEDRADAR_STORAGE_BACKEND:'postgres'}),
    /postgres_production_not_armed/
  );

  const production={
    BOOKEDRADAR_STORAGE_BACKEND:'postgres',
    POSTGRES_PRODUCTION_ARMED:'true',
    DATABASE_URL:'postgres://bookedradar:synthetic@internal.render/bookedradar_postgres_production',
    POSTGRES_VALIDATED_MIGRATION_ID:'production-shadow-20260929-final',
    POSTGRES_VALIDATED_SNAPSHOT_FINGERPRINT:fingerprint,
  };
  assert.equal(postgresBackendConfig(production).mode,'production');
  assert.throws(
    ()=>postgresBackendConfig({...production,DATABASE_URL:'postgres://test:synthetic@127.0.0.1/bookedradar_test'}),
    /managed_database/
  );

  const lab={BOOKEDRADAR_STORAGE_BACKEND:'postgres_lab',DATABASE_URL:'postgres://test:synthetic@127.0.0.1/bookedradar_test'};
  assert.ok(postgresLabConfig(lab));
  assert.throws(()=>postgresLabConfig({...lab,DATABASE_URL:'postgres://test:synthetic@internal.render/bookedradar'}),/disposable_database/);
  assert.throws(()=>postgresLabConfig({...lab,DISPATCH_ENABLED:'true'}),/providers_disabled/);
  assert.throws(()=>postgresLabConfig({...lab,OPENAI_API_KEY:'synthetic'}),/providers_disabled/);
  assert.throws(()=>postgresLabConfig({...lab,CRM_SMOKE_TEST_ON_STARTUP:'true'}),/providers_disabled/);
});
