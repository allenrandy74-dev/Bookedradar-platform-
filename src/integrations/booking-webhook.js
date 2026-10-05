import { unsupportedBookingAuthority } from "./booking-authority.js";

export class BookingWebhookAdapter {
  get supportsLiveBooking() { return false; }
  constructor({ url, token = "", timeoutMs = 8000 }) {
    this.url = url;
    this.token = token;
    this.timeoutMs = timeoutMs;
  }

  async request(action, payload) {
    if (action !== "find_availability") return unsupportedBookingAuthority("webhook");
    if (!this.url) throw new Error("Booking webhook adapter is not configured");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: JSON.stringify({ request: payload?.request || {}, action }),
      });
      const text = await response.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
      if (!response.ok) {
        throw new Error(`Booking webhook failed (${response.status}): ${data?.error || text}`);
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  async findAvailability(request) {
    const data = await this.request("find_availability", { request });
    return { ...data, mode: "live_booking", confirmed: false, bookingId: null,
      message: "Availability is advisory. The team must confirm any appointment request." };
  }

  createBooking(request) {
    return Promise.resolve(unsupportedBookingAuthority("webhook"));
  }
}
