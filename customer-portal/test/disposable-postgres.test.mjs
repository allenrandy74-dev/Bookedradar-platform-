import test from 'node:test';
import assert from 'node:assert/strict';
import { requireDisposablePostgres } from './disposable-postgres.mjs';
const valid = 'postgresql://test_user:synthetic@127.0.0.1:5432/bookedradar_portal_test';
test('integration guard requires explicit acknowledgment and exact disposable local database', () => {
  assert.equal(requireDisposablePostgres({ PORTAL_TEST_ACK: 'disposable', PORTAL_TEST_DATABASE_URL: valid }).database, 'bookedradar_portal_test');
  for (const url of [valid.replace('bookedradar_portal_test', 'bookedradar'), valid.replace('bookedradar_portal_test', 'production_portal_test'), valid.replace('127.0.0.1', 'db.example.com'), valid + '?database=production', valid + '?host=db.example.com', valid + '#fragment', valid.replace('postgresql:', 'https:'), valid.replace('bookedradar_portal_test', 'bookedradar_portal_test/other'), 'invalid']) assert.throws(() => requireDisposablePostgres({ PORTAL_TEST_ACK: 'disposable', PORTAL_TEST_DATABASE_URL: url }));
  assert.throws(() => requireDisposablePostgres({ PORTAL_TEST_DATABASE_URL: valid }));
  assert.throws(() => requireDisposablePostgres({ PORTAL_TEST_ACK: 'disposable' }));
});
