import { createHash, randomUUID } from "node:crypto";

const needsReview = () => ({ confirmed: false, bookingId: null, reason: "booking_result_requires_review", reconciliationRequired: true });

export async function createBookingOnce({ store, adapter, request }) {
  if (!store?.claimBooking || !store?.finishBooking) {
    return { confirmed: false, bookingId: null, reason: "durable_booking_store_required" };
  }
  if (!request?.callId || !request?.tenantId || store.tenantId !== request.tenantId) {
    return { confirmed: false, bookingId: null, reason: "booking_identity_required" };
  }
  const call = await store.getCall(request.callId);
  if (!call || call.tenantId !== request.tenantId) {
    return { confirmed: false, bookingId: null, reason: "booking_call_state_required" };
  }
  const requestHash = createHash("sha256").update(JSON.stringify(
    Object.keys(request).sort().map(key => [key, request[key]])
  )).digest("hex");
  const attemptId = randomUUID();
  const claimed = await store.claimBooking(request.callId, { attemptId, requestHash });
  if (!claimed) {
    const attempt = (await store.getCall(request.callId))?.bookingAttempt;
    if (!attempt || attempt.requestHash !== requestHash) {
      return { confirmed: false, bookingId: null, reason: "booking_request_conflict", reconciliationRequired: true };
    }
    const result = attempt.result;
    const verifiedReplay = attempt.status === "confirmed" && result?.confirmed === true && typeof result.bookingId === "string" && result.bookingId.trim();
    if (verifiedReplay || (attempt.status === "unconfirmed" && result?.confirmed === false)) {
      return { ...attempt.result, duplicate: true };
    }
    return needsReview();
  }

  let result, status;
  try {
    result = await adapter.createBooking(request);
    const receipt = result?.confirmed === true && typeof result.bookingId === "string" && result.bookingId.trim();
    if (receipt) {
      result = { ...result, bookingId: result.bookingId.trim() };
      status = "confirmed";
    } else if (result?.confirmed === false && ["slot_no_longer_available", "slot_unavailable", "live_booking_not_enabled", "declined"].includes(result.reason)) {
      status = "unconfirmed";
    } else {
      result = needsReview();
      status = "uncertain";
    }
  } catch {
    result = needsReview();
    status = "uncertain";
  }
  try {
    const saved = await store.finishBooking(request.callId, attemptId, { status, result });
    return saved ? result : needsReview();
  } catch {
    // The pending claim is already durable. A receipt-write failure must not
    // report completion or trigger another provider request after restart.
    return needsReview();
  }
}
