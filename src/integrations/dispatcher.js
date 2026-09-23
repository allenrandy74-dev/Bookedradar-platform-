import { renderTemplate } from "../recovery/templates.js";
import { actionAllowed } from "../recovery/compliance.js";

export function voiceContactResolver(state, tenantId) {
  return async ({ action, contact, opportunity }) => {
    if (!["human_task", "human_alert"].includes(action.channel) || !opportunity?.metadata?.callId) return contact;
    if (opportunity.tenantId !== tenantId) throw new Error("Voice follow-up tenant mismatch");
    const call = await state.getCall(opportunity.metadata.callId);
    if (!call) return contact;
    if (call.tenantId !== tenantId) throw new Error("Voice call tenant mismatch");
    if (!call.lastLead) return contact;
    return { ...contact, name: call.lastLead.name || "", firstName: "", lastName: "", phone: call.lastLead.callback_number || contact?.phone || "" };
  };
}

export class ActionDispatcher {
  constructor({ store, tenant, adapters = {}, workerId = "bookedradar-dispatcher", resolveContact }) {
    this.store = store;
    this.tenant = tenant;
    this.adapters = adapters;
    this.workerId = workerId;
    this.resolveContact = resolveContact;
  }

  async runOnce({ now = new Date(), limit = 25 } = {}) {
    const claimed = await this.store.claimDueActions({
      now,
      workerId: this.workerId,
      limit,
      tenantId: this.tenant.tenantId,
    });

    const results = [];

    for (const action of claimed) {
      if (action.tenantId !== this.tenant.tenantId) {
        await this.store.patchAction(action.id, {
          status: "pending",
          claimedBy: null,
          claimExpiresAt: null,
        });
        continue;
      }

      const opportunity = await this.store.getOpportunity(action.opportunityId);
      let contact = await this.store.getContact(action.contactKey);

      const decision = actionAllowed({
        action,
        opportunity,
        contact,
        tenant: this.tenant,
        now,
      });

      if (!decision.allowed) {
        const blocked = await this.store.patchAction(action.id, {
          status: "blocked",
          blockedReason: decision.reason,
          completedAt: new Date().toISOString(),
        });
        results.push({ action: blocked, dispatched: false });
        continue;
      }

      const adapter = this.adapters[action.channel];
      if (!adapter) {
        const deferred = await this.store.patchAction(action.id, {
          status: "pending",
          lastError: `No adapter configured for channel: ${action.channel}`,
          claimedBy: null,
          claimExpiresAt: null,
        });
        results.push({ action: deferred, dispatched: false, deferred: true });
        continue;
      }

      try {
        if (this.resolveContact) contact = await this.resolveContact({ action, contact, opportunity });
        const content =
          ["sms", "email"].includes(action.channel)
            ? renderTemplate(action.template, { contact, tenant: this.tenant, opportunity })
            : null;

        const result = await adapter.send({
          action,
          contact,
          opportunity,
          tenant: this.tenant,
          content,
        });

        const completed = await this.store.patchAction(action.id, {
          status: "completed",
          completedAt: new Date().toISOString(),
          providerResult: result || null,
        });
        results.push({ action: completed, dispatched: true, result });
      } catch (error) {
        const attempts = Number(action.attempts || 0) + 1;
        const maxAttempts = Number(this.tenant?.policies?.maxDispatchAttempts || 3);
        const baseMinutes = Number(this.tenant?.policies?.retryBaseMinutes || 5);
        const failed = attempts >= maxAttempts;
        const retryDelayMs = baseMinutes * 60 * 1000 * (2 ** Math.max(0, attempts - 1));

        const updated = await this.store.patchAction(action.id, {
          status: failed ? "failed" : "pending",
          attempts,
          dueAt: failed ? action.dueAt : new Date(Date.now() + retryDelayMs).toISOString(),
          lastError: String(error?.message || error).slice(0, 500),
          claimedBy: null,
          claimedAt: null,
          claimExpiresAt: null,
        });
        results.push({ action: updated, dispatched: false, error: updated.lastError });
      }
    }

    return results;
  }
}
