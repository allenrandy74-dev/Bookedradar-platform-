import { dispatchGate } from './dispatch-gate.js';
import { actionAllowed } from './recovery/compliance.js';

const replyAction = { channel: 'sms', purpose: 'transactional', template: 'inbound_sms_reply' };

// Runs inside the tenant's recovery transaction. The event and action commit
// together; no provider request is made here or on the webhook request path.
export async function persistSmsReply(store, tenant, request, now = new Date()) {
  if (request.tenantId !== tenant.tenantId || !request.contactKey?.startsWith(`${tenant.tenantId}:`)) throw new Error('sms_reply_tenant_mismatch');
  if (!/^(SM|MM)[0-9a-fA-F]{32}$/.test(request.messageSid || '')) throw new Error('sms_reply_identity_required');
  const opportunity = await store.getOpportunity(request.opportunityId);
  if (!opportunity || opportunity.tenantId !== tenant.tenantId || opportunity.contactKey !== request.contactKey) throw new Error('sms_reply_opportunity_mismatch');
  const contact = await store.getContact(request.contactKey);
  const decision = actionAllowed({ action: replyAction, opportunity, contact, tenant, now });
  if (!decision.allowed) return { queued: false, reason: decision.reason };
  const content = typeof request.content === 'string' ? request.content.trim() : '';
  if (!content || content.length > 600) throw new Error('sms_reply_content_invalid');
  const receipt = await store.addEvent({
    tenantId: tenant.tenantId, type: 'sms_reply_queued',
    idempotencyKey: `sms-reply:${tenant.tenantId}:${request.messageSid}`,
    opportunityId: opportunity.id, contactKey: request.contactKey,
  });
  if (receipt.duplicate) return { queued: false, duplicate: true };
  const action = await store.scheduleAction({ ...replyAction, tenantId: tenant.tenantId,
    opportunityId: opportunity.id, contactKey: request.contactKey,
    content, dueAt: now.toISOString(), sourceMessageSid: request.messageSid });
  return { queued: true, actionId: action.id };
}

export async function queueSmsReply({ tenant, store, env = process.env, messageSid, contactKey, opportunity, generate }) {
  const gate = dispatchGate(tenant, env);
  if (!gate.armed) return { queued: false, reason: gate.reason };
  if (tenant?.features?.twoWaySms !== true || tenant?.integrations?.sms?.enabled !== true) return { queued: false, reason: 'sms_disabled' };
  if (typeof store?.queueSmsReplyOnce !== 'function' || store.tenantId !== tenant.tenantId) return { queued: false, reason: 'durable_sms_reply_store_required' };
  if (!/^(SM|MM)[0-9a-fA-F]{32}$/.test(messageSid || '')) return { queued: false, reason: 'sms_reply_identity_required' };
  if (typeof store.smsReplyQueued === 'function' && await store.smsReplyQueued(messageSid)) return { queued: false, duplicate: true };
  const contact = await store.getContact(contactKey);
  const decision = actionAllowed({ action: replyAction, opportunity, contact, tenant });
  if (!decision.allowed) return { queued: false, reason: decision.reason };
  const content = await generate(contact);
  // Recheck the arm flag and stored consent after generation. The dispatcher
  // independently checks current permissions again before provider dispatch.
  const finalGate = dispatchGate(tenant, env);
  if (!finalGate.armed) return { queued: false, reason: finalGate.reason };
  return store.queueSmsReplyOnce({ tenantId: tenant.tenantId, messageSid, contactKey, opportunityId: opportunity.id, content }, tenant);
}
