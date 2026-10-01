export class BookingWebhookAdapter {
  constructor({ url, token = "", timeoutMs = 8000 }) {
    this.url = url;
    this.token = token;
    this.timeoutMs = timeoutMs;
  }

  async request(action, payload) {
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
        body: JSON.stringify({ action, ...payload }),
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

  findAvailability(request) {
    return this.request("find_availability", { request });
  }

  async createBooking(request) {
    const data = await this.request("create_booking", { request });
    const unverified = { confirmed: false, bookingId: null, reason: "booking_confirmation_unverified" };
    if (!data || typeof data !== "object" || Array.isArray(data)) return unverified;

    const bookingId = typeof data.bookingId === "string" ? data.bookingId.trim() : "";
    // HTTP success alone is not a booking receipt. Do not throw or retry an
    // ambiguous write: the provider may already have created an appointment.
    if (data.confirmed === true && bookingId) return { ...data, bookingId };
    if (data.confirmed === false) return { ...data, confirmed: false, bookingId: bookingId || null };
    return { ...data, ...unverified };
  }
}
