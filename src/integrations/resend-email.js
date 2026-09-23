export class ResendEmailAdapter {
  constructor({
    apiKey,
    from,
    replyTo = "",
    apiUrl = "https://api.resend.com/emails",
  }) {
    this.apiKey = apiKey;
    this.from = from;
    this.replyTo = replyTo;
    this.apiUrl = apiUrl;
  }

  async send({ contact, content, tenant, action }) {
    if (!this.apiKey) throw new Error("Resend API key is not configured");
    if (!this.from) throw new Error("Resend sender is not configured");
    if (!contact?.email) throw new Error("Contact has no email address");

    const body = {
      from: this.from,
      to: [contact.email],
      subject: `${tenant.businessName} follow-up`,
      text: content,
      ...(this.replyTo ? { reply_to: [this.replyTo] } : {}),
    };

    const response = await fetch(this.apiUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...(action?.id
          ? { "Idempotency-Key": `bookedradar/${tenant.tenantId}/${action.id}` }
          : {}),
      },
      body: JSON.stringify(body),
    });

    const raw = await response.text();
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = raw || null;
    }

    if (!response.ok) {
      const detail =
        typeof data === "object" && data
          ? data.message || data.name || JSON.stringify(data)
          : String(data || "");
      throw new Error(
        `Resend email failed (${response.status})${detail ? `: ${detail}` : ""}`
      );
    }

    return {
      provider: "resend",
      accepted: true,
      id: data?.id || null,
    };
  }
}
