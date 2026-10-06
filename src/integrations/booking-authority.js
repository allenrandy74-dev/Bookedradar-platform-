/**
 * No currently shipped adapter implements an authoritative reservation protocol.
 * This is an unconditional deny, not an injectable capability flag: a configured
 * calendar/webhook or a process-local "lock" must never opt back into unsafe
 * writes. Availability is advisory only.
 *
 * A future implementation needs independently verified shared-resource identity
 * (including aliases such as "primary"), durable atomic overlap exclusion across
 * tenants/processes/restarts, stable intent identity, provider reconciliation of
 * unknown outcomes without blind retries, and an explicit external-writer
 * policy. A database lock alone cannot lock a third party's Calendar UI.
 *
 * Historical uncertain writes remain a manual reconciliation obligation. This
 * refusal makes no claim that a past event was absent, cancelled, or reconciled.
 */
export function unsupportedBookingAuthority(provider) {
  return {
    mode: "live_booking",
    confirmed: false,
    bookingId: null,
    reason: "booking_authority_unavailable",
    needsHumanReview: true,
    calendarProvider: provider,
    message: "Automatic booking is unavailable. The team must review and confirm this request, including any previous uncertain booking attempt.",
  };
}
