import { recipientSuppressed } from './recovery/engine.js';
import { createHash } from 'node:crypto';
import { dispatchGate } from './dispatch-gate.js';
import { actionAllowed } from './recovery/compliance.js';

const actionType = { channel: 'sms', purpose: 'transactional', template: 'caller_text' };

export async function persistCallerText(store, tenant, request, now = new Date()) {
  if (request.tenantId !== tenant.tenantId || !request.contactKey?.startsWith(`${tenant.tenantId}:`)) throw new Error('caller_text_tenant_mismatch');
  if (typeof request.callId !== 'string' || !request.callId.trim() || request.callId.length > 256 || typeof request.toolCallId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(request.toolCallId)) throw new Error('caller_text_identity_required');
  if (request.callerRequested !== true || typeof request.to !== 'string' || !/^\+[1-9]\d{7,14}$/.test(request.to) || request.confirmedCallbackNumber !== request.to) return { queued: false, reason: 'caller_request_confirmation_required' };
  const content = typeof request.content === 'string' ? request.content.trim() : '';
  if (!content || content.length > 480) throw new Error('caller_text_content_invalid');
  const opportunity = await store.getOpportunity(request.opportunityId);
  if (!opportunity || opportunity.tenantId !== tenant.tenantId || opportunity.contactKey !== request.contactKey || opportunity.metadata?.callId !== request.callId) throw new Error('caller_text_opportunity_mismatch');
  const contact = await store.getContact(request.contactKey);
  if (!contact || contact.phone !== request.to) return { queued: false, reason: 'caller_text_recipient_changed' };
  if (await recipientSuppressed(store, tenant.tenantId, contact)) return { queued: false, reason: 'contact_suppressed' };
  const decision = actionAllowed({ action: actionType, opportunity, contact, tenant, now });
  if (!decision.allowed) return { queued: false, reason: decision.reason };
  const key = `caller-text:${tenant.tenantId}:${request.callId}:${request.toolCallId}`;
  const requestHash = createHash('sha256').update(JSON.stringify([request.to, content, request.opportunityId])).digest('hex');
  const previous = store.data.events.find(event => event.idempotencyKey === key);
  if (previous) {
    if (previous.requestHash !== requestHash) return { queued: false, reason: 'caller_text_request_conflict' };
    const action = store.data.actions[previous.actionId];
    return { queued: false, duplicate: true, actionId: previous.actionId, status: action?.status || 'unknown' };
  }
  const action = await store.scheduleAction({ ...actionType, tenantId: tenant.tenantId,
    opportunityId: opportunity.id, contactKey: request.contactKey, content,
    dueAt: now.toISOString(), sourceCallId: request.callId, sourceToolCallId: request.toolCallId,
    expectedRecipient: request.to, callerRequested: true, confirmedCallbackNumber: request.confirmedCallbackNumber });
  await store.addEvent({ tenantId: tenant.tenantId, type: 'caller_text_queued',
    idempotencyKey: key, opportunityId: opportunity.id, contactKey: request.contactKey,
    actionId: action.id, requestHash });
  return { queued: true, actionId: action.id, status: action.status };
}

export async function queueCallerText({ tenant, store, state, callId, toolCallId, content, callerRequested, confirmedCallbackNumber, env = process.env }) {
  const gate = dispatchGate(tenant, env);
  if (!gate.armed) return { queued: false, reason: gate.reason };
  if (tenant?.features?.callerTexting !== true || tenant?.integrations?.sms?.enabled !== true) return { queued: false, reason: 'caller_texting_not_ready' };
  if (typeof store?.queueCallerTextOnce !== 'function' || store.tenantId !== tenant.tenantId) return { queued: false, reason: 'durable_caller_text_store_required' };
  if (typeof toolCallId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(toolCallId)) return { queued: false, reason: 'caller_text_identity_required' };
  if (callerRequested !== true || typeof confirmedCallbackNumber !== 'string' || !/^\+[1-9]\d{7,14}$/.test(confirmedCallbackNumber)) return { queued: false, reason: 'caller_request_confirmation_required' };
  const call = await state.getCall(callId);
  if (!call || call.tenantId !== tenant.tenantId || !call.opportunityId) return { queued: false, reason: 'caller_text_call_state_required' };
  const to = String(call.lastLead?.callback_number || '').trim();
  if (!/^\+[1-9]\d{7,14}$/.test(to)) return { queued: false, reason: 'confirmed_callback_required' };
  if (confirmedCallbackNumber !== to) return { queued: false, reason: 'confirmed_callback_mismatch' };
  const opportunity = await store.getOpportunity(call.opportunityId);
  if (!opportunity || opportunity.tenantId !== tenant.tenantId || !opportunity.contactKey?.startsWith(`${tenant.tenantId}:`)) return { queued: false, reason: 'caller_text_opportunity_required' };
  return store.queueCallerTextOnce({ tenantId: tenant.tenantId, callId, toolCallId, content, callerRequested, confirmedCallbackNumber,
    to, contactKey: opportunity.contactKey, opportunityId: call.opportunityId }, tenant);
}
