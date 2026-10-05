import test from 'node:test';
import assert from 'node:assert/strict';
import { createBookingOnce } from '../src/integrations/booking-once.js';

for (const status of [null, 'pending', 'uncertain', 'confirmed', 'unconfirmed']) {
  test(`unsupported lab booking does not write or replay ${status || 'absent'} history`, async () => {
    const saved = { tenantId: 'synthetic-hvac', ...(status ? { bookingAttempt: { status, attemptId: 'old', result: { confirmed: true, bookingId: 'old-receipt' } } } : {}) };
    const before = structuredClone(saved);
    let operations = 0;
    const forbidden = async () => { operations++; throw Error('must not access provider or state'); };
    const store = { tenantId: saved.tenantId, getCall: forbidden, claimBooking: forbidden, finishBooking: forbidden };
    const adapter = { createBooking: forbidden };
    const request = { tenantId: saved.tenantId, callId: 'synthetic', slot: 'requested-slot' };
    const results = await Promise.all(Array.from({ length: 40 }, () => createBookingOnce({ store, adapter, request })));
    results.push(await createBookingOnce({ store, adapter, request: { ...request, slot: 'changed-slot' } }));
    results.push(await createBookingOnce({}));
    for (const result of results) {
      assert.equal(result.reason, 'booking_authority_unavailable');
      assert.equal(result.confirmed, false); assert.equal(result.bookingId, null); assert.equal(result.needsHumanReview, true);
    }
    assert.equal(operations, 0); assert.deepEqual(saved, before);
  });
}
