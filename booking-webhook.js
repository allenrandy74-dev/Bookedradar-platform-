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

  createBooking(request) {
    return this.request("create_booking", { request });
  }
}
