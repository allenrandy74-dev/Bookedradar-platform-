import { unsupportedBookingAuthority } from "./booking-authority.js";

// Do not claim new attempts, replay old provider success, or call injected
// adapters. Existing pending/uncertain records remain in the read-only review
// queue; refusal does not resolve, cancel, or overwrite that history.
export async function createBookingOnce() {
  return unsupportedBookingAuthority("private_lab");
}
