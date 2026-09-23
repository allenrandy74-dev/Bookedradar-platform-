import { createWixContact, createWixFollowupTask } from "../wix.js";

export class WixHumanTaskAdapter {
  constructor({
    apiKey,
    siteId,
    timeoutMs = 8000,
    retries = 3,
  }) {
    this.apiKey = apiKey;
    this.siteId = siteId;
    this.timeoutMs = timeoutMs;
    this.retries = retries;
  }

  async send({ action, contact, opportunity }) {
    if (!this.apiKey || !this.siteId) {
      throw new Error("Wix human-task adapter is not configured");
    }

    const lead = {
      name: contact?.name || [contact?.firstName, contact?.lastName].filter(Boolean).join(" "),
      callback_number: contact?.phone || "",
      email: contact?.email || "",
      service_type: opportunity?.serviceType || action.template,
      urgency: opportunity?.urgency || "",
      preferred_window: opportunity?.metadata?.preferredWindow || "",
      service_address: opportunity?.metadata?.serviceAddress || "",
      city: opportunity?.metadata?.city || "",
      notes: [
        opportunity?.metadata?.notes || "",
        `Recovery action ${action.template} for opportunity ${action.opportunityId}`,
      ].filter(Boolean).join("\n\n"),
      call_id: opportunity?.metadata?.callId || "",
    };

    const contactResult = await createWixContact({
      apiKey: this.apiKey,
      siteId: this.siteId,
      lead,
      timeoutMs: this.timeoutMs,
      retries: this.retries,
    });

    if (!contactResult.ok || !contactResult.contactId) {
      throw new Error(`Unable to create/reuse Wix contact: ${contactResult.reason || "unknown_error"}`);
    }

    const taskResult = await createWixFollowupTask({
      apiKey: this.apiKey,
      siteId: this.siteId,
      contactId: contactResult.contactId,
      lead,
      dueInMinutes: 0,
      timeoutMs: this.timeoutMs,
      retries: this.retries,
    });

    if (!taskResult.ok) {
      throw new Error("Unable to create Wix follow-up task");
    }

    return {
      provider: "wix",
      contactId: contactResult.contactId,
      contactReused: Boolean(contactResult.reused),
      taskId: taskResult.taskId,
    };
  }
}
