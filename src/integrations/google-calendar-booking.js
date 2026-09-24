import { BookingAdapter } from "./booking.js";

function clean(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function iso(value) {
  const text = clean(value, 80);
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
}

function positiveInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return fallback;
  return n;
}

function overlap(start, end, busy) {
  const a = new Date(start).getTime(), b = new Date(end).getTime();
  return busy.some(item => {
    const s = new Date(item.start).getTime(), e = new Date(item.end).getTime();
    return a < e && b > s;
  });
}

export class GoogleCalendarBookingAdapter extends BookingAdapter {
  constructor({
    clientId,
    clientSecret,
    refreshToken,
    calendarId = "primary",
    timeZone = "America/Chicago",
    defaultDurationMinutes = 60,
    slotIncrementMinutes = 30,
    timeoutMs = 8000,
    fetchImpl = globalThis.fetch,
  } = {}) {
    super();
    Object.assign(this, {
      clientId, clientSecret, refreshToken, calendarId, timeZone,
      defaultDurationMinutes: positiveInt(defaultDurationMinutes, 60, 15, 480),
      slotIncrementMinutes: positiveInt(slotIncrementMinutes, 30, 5, 120),
      timeoutMs, fetchImpl,
    });
    this.cachedToken = null;
    this.cachedTokenExpiresAt = 0;
  }

  ready() {
    return Boolean(this.clientId && this.clientSecret && this.refreshToken && this.calendarId);
  }

  async accessToken() {
    if (!this.ready()) throw new Error("google_calendar_not_configured");
    if (this.cachedToken && Date.now() < this.cachedTokenExpiresAt - 60_000) return this.cachedToken;

    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: this.refreshToken,
      grant_type: "refresh_token",
    });
    const response = await this.fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) throw new Error("google_calendar_token_refresh_failed");
    this.cachedToken = data.access_token;
    this.cachedTokenExpiresAt = Date.now() + positiveInt(data.expires_in, 3600, 60, 86400) * 1000;
    return this.cachedToken;
  }

  async request(url, options = {}) {
    const token = await this.accessToken();
    const response = await this.fetchImpl(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch {}
    if (!response.ok) {
      const error = new Error(`google_calendar_request_failed:${response.status}`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async findAvailability(request = {}) {
    const timeMin = iso(request.windowStart || request.window_start);
    const timeMax = iso(request.windowEnd || request.window_end);
    if (!timeMin || !timeMax) {
      return {
        mode: "live_booking",
        confirmed: false,
        needsWindowRange: true,
        message: "A concrete availability window is required before checking the calendar.",
      };
    }
    const minMs = new Date(timeMin).getTime();
    const maxMs = new Date(timeMax).getTime();
    if (maxMs <= minMs || maxMs - minMs > 7 * 24 * 60 * 60 * 1000) {
      throw new Error("invalid_availability_window");
    }

    const duration = positiveInt(request.durationMinutes || request.duration_minutes, this.defaultDurationMinutes, 15, 480);
    const data = await this.request("https://www.googleapis.com/calendar/v3/freeBusy", {
      method: "POST",
      body: JSON.stringify({
        timeMin,
        timeMax,
        timeZone: this.timeZone,
        items: [{ id: this.calendarId }],
      }),
    });
    const busy = data?.calendars?.[this.calendarId]?.busy || [];
    const stepMs = this.slotIncrementMinutes * 60_000;
    const durationMs = duration * 60_000;
    const slots = [];
    for (let start = minMs; start + durationMs <= maxMs && slots.length < 5; start += stepMs) {
      const end = start + durationMs;
      const startIso = new Date(start).toISOString();
      const endIso = new Date(end).toISOString();
      if (!overlap(startIso, endIso, busy)) {
        slots.push({
          id: `${startIso}|${endIso}`,
          start: startIso,
          end: endIso,
          durationMinutes: duration,
        });
      }
    }
    return {
      mode: "live_booking",
      confirmed: false,
      calendarProvider: "google",
      timeZone: this.timeZone,
      slots,
      message: slots.length ? "Live availability checked." : "No open slots found in that window.",
    };
  }

  async createBooking(request = {}) {
    const encoded = clean(request.slot, 200);
    let start = iso(request.slotStart || request.slot_start);
    let end = iso(request.slotEnd || request.slot_end);
    if ((!start || !end) && encoded.includes("|")) {
      const [a, b] = encoded.split("|", 2);
      start = iso(a); end = iso(b);
    }
    if (!start || !end || new Date(end) <= new Date(start)) throw new Error("invalid_booking_slot");

    // Re-check free/busy immediately before writing to reduce double-book risk.
    const availability = await this.findAvailability({
      windowStart: start,
      windowEnd: end,
      durationMinutes: Math.round((new Date(end) - new Date(start)) / 60000),
    });
    if (!availability.slots.some(slot => slot.start === start && slot.end === end)) {
      return { mode: "live_booking", confirmed: false, reason: "slot_no_longer_available" };
    }

    const name = clean(request.name, 120) || "Customer";
    const serviceType = clean(request.serviceType || request.service_type, 180) || "Service request";
    const callback = clean(request.callbackNumber || request.callback_number, 60);
    const address = clean(request.serviceAddress || request.service_address, 240);
    const city = clean(request.city, 120);
    const notes = clean(request.notes, 1200);
    const description = [
      callback ? `Callback: ${callback}` : "",
      address ? `Service address: ${address}${city ? `, ${city}` : ""}` : city ? `City: ${city}` : "",
      notes ? `Notes: ${notes}` : "",
      request.callId ? `BookedRadar call: ${clean(request.callId,160)}` : "",
    ].filter(Boolean).join("\n");

    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.calendarId)}/events`;
    const event = await this.request(url, {
      method: "POST",
      body: JSON.stringify({
        summary: `${serviceType} — ${name}`,
        description,
        location: [address, city].filter(Boolean).join(", "),
        start: { dateTime: start, timeZone: this.timeZone },
        end: { dateTime: end, timeZone: this.timeZone },
        extendedProperties: {
          private: {
            bookedradar_tenant_id: clean(request.tenantId,100),
            bookedradar_source: "ai_phone_operator",
          },
        },
      }),
    });
    return {
      mode: "live_booking",
      confirmed: Boolean(event?.id),
      bookingId: event?.id || null,
      slot: encoded || `${start}|${end}`,
      start,
      end,
      calendarProvider: "google",
    };
  }
}
