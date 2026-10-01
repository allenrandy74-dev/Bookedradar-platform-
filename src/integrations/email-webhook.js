export class EmailWebhookAdapter {
  constructor({ url, token = "", timeoutMs = 8000 }) {
    this.timeoutMs = Math.min(60000, Math.max(1, Number(timeoutMs) || 8000));
    this.url = url;
    this.token = token;
  }

  async send({ contact, content, tenant, action }) {
    if (!this.url) throw new Error("Email webhook adapter is not configured");
    if (!contact?.email) throw new Error("Contact has no email address");

    const response = await fetch(this.url, {
      method: "POST",
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: {
        "Content-Type": "application/json",
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify({
        to: contact.email,
        subject: `${tenant.businessName} follow-up`,
        text: content,
        metadata: {
          opportunityId: action.opportunityId,
          template: action.template,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Email webhook failed (${response.status})`);
    }

    let data = null;
    try { data = await response.json(); } catch {}
    if (data?.accepted !== true || typeof data.id !== "string" || !data.id.trim()) {
      throw Object.assign(new Error("email_webhook_acceptance_unverified"), { reconciliationRequired: true });
    }
    return { provider: "email_webhook", accepted: true, id: data.id.trim() };
  }
}
