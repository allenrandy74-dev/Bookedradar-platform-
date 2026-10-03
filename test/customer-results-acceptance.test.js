import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { evaluateCustomerResultsCases } from './fixtures/customer-results-cases.js';
const report = await evaluateCustomerResultsCases(fileURLToPath(new URL('..', import.meta.url)));
for (const row of report.rows) {
  test('Customer results acceptance: ' + row.id, () => {
    assert.deepEqual(row.actual, row.expected, row.evidence);
  });
}
