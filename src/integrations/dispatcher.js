import { renderTemplate } from "../recovery/templates.js";
import { dispatchAllowed } from "../recovery/dispatch-policy.js";

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
      if (typeof this.store.beginDispatch === "function" && typeof this.store.finishClaim === "function") {
        results.push(await this.runFencedAction(action, now));
        continue;
      }
      // Stores without durable, fenced send intent cannot safely retry after
      // crashes. Refuse provider I/O rather than fall back to legacy send-first.
      results.push({ action, dispatched: false, reason: "dispatch_authority_unavailable" });
    }

    return results;
  }

  async runFencedAction(action, now) {
    if (action.tenantId !== this.tenant.tenantId) throw new Error("Dispatch tenant mismatch");
    const finish = patch => this.store.finishClaim(action.id, action, patch);
    const opportunity = await this.store.getOpportunity(action.opportunityId);
    let contact = await this.store.getContact(action.contactKey);
    const decision = dispatchAllowed({ action, opportunity, contact, tenant:this.tenant, now });
    if (!decision.allowed) {
      const blocked = await finish({ status:"blocked",blockedReason:decision.reason,completedAt:new Date().toISOString() });
      return { action:blocked,dispatched:false };
    }
    const adapter = this.adapters[action.channel];
    if (!adapter) {
      const deferred = await finish({ status:"pending",lastError:`No adapter configured for channel: ${action.channel}` });
      return { action:deferred,dispatched:false,deferred:true };
    }
    if (this.resolveContact) contact = await this.resolveContact({ action,contact,opportunity });
    let content = ["sms","email"].includes(action.channel)
      ? renderActionContent(action,{contact,tenant:this.tenant,opportunity}) : null;
    // Persist send intent before any provider request. Never automatically send
    // again after an ambiguous outcome or a failed completion write.
    const intent = await this.store.beginDispatch(action.id, action, new Date(), this.tenant);
    if (intent?.status === 'blocked') return { action: intent, dispatched: false };
    // Bind this queued SMS to its caller-confirmed recipient, not a stale
    // contact snapshot read before the transactional send-intent check.
    const { dispatchContact, ...fencedAction } = intent || {};
    if (intent?.status !== 'dispatching') throw new Error('dispatch_authority_unverified');
    const dispatchAction = { ...action, ...fencedAction };
    if (dispatchContact && ['sms', 'email'].includes(dispatchAction.channel)) {
      contact = dispatchContact;
      content = renderActionContent(dispatchAction, { contact, tenant: this.tenant, opportunity });
    }
    if (dispatchAction.expectedRecipient && dispatchAction.channel === 'sms') {
      contact = { ...contact, phone: dispatchAction.expectedRecipient };
      content = renderActionContent(dispatchAction, { contact, tenant: this.tenant, opportunity });
    }
    let result;
    try {
      result = await adapter.send({ action:dispatchAction,contact,opportunity,tenant:this.tenant,content,deliveryPolicy:"single_attempt" });
      if (!validDispatchReceipt(action.channel, result)) throw new Error("provider_acceptance_unverified");
    } catch (error) {
      const uncertain = await finish({ status:"reconciliation_required",failedAt:new Date().toISOString(),lastError:String(error?.message || error).slice(0,500) });
      return { action:uncertain,dispatched:false,reconciliationRequired:true,error:uncertain.lastError };
    }
    // A database failure here must propagate. It must not turn a successful
    // provider send into the legacy automatic retry path.
    const completed = await finish({ status:"completed",completedAt:new Date().toISOString(),providerResult:result || null });
    return { action:completed,dispatched:true,result };
  }
}


function renderActionContent(action, context) {
  if (!['inbound_sms_reply', 'caller_text'].includes(action.template)) return renderTemplate(action.template, context);
  if (action.channel !== 'sms' || action.purpose !== 'transactional' || typeof action.content !== 'string' || !action.content.trim() || action.content.length > 600) throw new Error('sms_reply_content_invalid');
  return action.content;
}


// Completion records provider acceptance (or a persisted internal task), never
// handset delivery/owner acknowledgment. Empty/coercible results are uncertainty.
function validDispatchReceipt(channel, result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return false;
  const text = value => typeof value === "string" && Boolean(value.trim());
  if (channel === "sms") return text(result.sid) &&
    (result.status === undefined || ["accepted", "scheduled", "queued", "sending", "sent", "delivered"].includes(result.status));
  if (channel === "email") return result.accepted === true && (result.provider === "email_webhook" || text(result.id));
  if (["human_task", "human_alert"].includes(channel)) {
    return text(result.taskId) || text(result.id) || text(result.receipt) ||
      (channel === "human_task" && result.provider === "internal" && text(result.task?.title));
  }
  return false;
}
