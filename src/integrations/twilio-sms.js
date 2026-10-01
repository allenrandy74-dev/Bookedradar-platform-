function basicAuth(username, password) {
  return Buffer.from(`${username}:${password}`).toString("base64");
}

export class TwilioSmsAdapter {
  constructor({ accountSid, authToken, fromNumber, timeoutMs = 8000 }) {
    this.timeoutMs = Math.min(60000, Math.max(1, Number(timeoutMs) || 8000));
    this.accountSid = accountSid;
    this.authToken = authToken;
    this.fromNumber = fromNumber;
  }

  async send({ contact, content }) {
    if (!this.accountSid || !this.authToken || !this.fromNumber) {
      throw new Error("Twilio SMS adapter is not configured");
    }
    const to = contact?.phone;
    if (!to) throw new Error("Contact has no phone number");

    const body = new URLSearchParams({
      To: to,
      From: this.fromNumber,
      Body: content,
    });

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.accountSid)}/Messages.json`,
      {
        method: "POST",
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: {
          Authorization: `Basic ${basicAuth(this.accountSid, this.authToken)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      }
    );

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!response.ok) {
      throw new Error(`Twilio SMS failed (${response.status}): ${data?.message || text}`);
    }

    if (typeof data?.sid !== "string" || !/^(SM|MM)[0-9a-fA-F]{32}$/.test(data.sid) ||
        !["accepted", "scheduled", "queued", "sending", "sent", "delivered"].includes(data.status)) {
      throw Object.assign(new Error("twilio_sms_acceptance_unverified"), { reconciliationRequired: true });
    }

    return {
      provider: "twilio",
      accepted: true,
      sid: data.sid,
      status: data.status,
    };
  }
}
