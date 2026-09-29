import crypto from "node:crypto";

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function tenantFromContactKey(contactKey = "") {
  const value = String(contactKey || "");
  const index = value.indexOf(":");
  return index > 0 ? value.slice(0, index) : "";
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, canonicalize(value[key])])
    );
  }
  return value;
}

export function stableHash(value) {
  const json = JSON.stringify(canonicalize(value));
  return crypto.createHash("sha256").update(json).digest("hex");
}

function safeRef(value = "") {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
}

function issue(list, code, detail = {}) {
  list.push({ code, ...detail });
}

export function auditPostgresMigrationSnapshot(snapshot = {}) {
  const state = object(snapshot.state);
  const recovery = object(snapshot.recovery);
  const callHistory = object(snapshot.callHistory);
  const webChat = object(snapshot.webChat);
  const transfers = object(snapshot.transfers);
  const growth = object(snapshot.growthMetrics);
  const leads = array(snapshot.leads);
  const billingTest = snapshot.billingTest == null ? null : object(snapshot.billingTest);
  const billingLive = snapshot.billingLive == null ? null : object(snapshot.billingLive);

  const errors = [];
  const warnings = [];

  const controlCalls = object(state.calls);
  const historyCalls = object(callHistory.calls);
  const contacts = object(recovery.contacts);
  const opportunities = object(recovery.opportunities);
  const actions = object(recovery.actions);
  const attribution = object(recovery.attribution);
  const events = array(recovery.events);
  const sessions = object(webChat.sessions);
  const transferRecords = object(transfers.calls || transfers.records || transfers);
  const processedWebhooks = object(state.processedWebhooks);
  const metricCounts = object(growth.counts);

  const opportunityTenant = new Map();
  const sourceEventTenant = new Map();

  for (const [id, opportunity] of Object.entries(opportunities)) {
    const tenantId = String(opportunity?.tenantId || "");
    if (!tenantId) issue(errors, "opportunity_missing_tenant", { id });
    if (!opportunity?.contactKey) issue(errors, "opportunity_missing_contact_key", { id });
    if (!opportunity?.status) issue(errors, "opportunity_missing_status", { id });
    if (tenantId) opportunityTenant.set(id, tenantId);
    if (opportunity?.sourceEventId && tenantId) {
      const prior = sourceEventTenant.get(String(opportunity.sourceEventId));
      if (prior && prior !== tenantId) {
        issue(errors, "source_event_cross_tenant", {
          eventId: String(opportunity.sourceEventId),
          tenants: [prior, tenantId],
        });
      }
      sourceEventTenant.set(String(opportunity.sourceEventId), tenantId);
    }
  }

  for (const [contactKey, contact] of Object.entries(contacts)) {
    const keyTenant = tenantFromContactKey(contactKey);
    const payloadTenant = String(contact?.tenantId || "");
    if (!keyTenant) issue(errors, "contact_key_not_tenant_namespaced", { contactRef: safeRef(contactKey) });
    if (payloadTenant && keyTenant && payloadTenant !== keyTenant) {
      issue(errors, "contact_cross_tenant_mismatch", {
        contactRef: safeRef(contactKey),
        keyTenant,
        payloadTenant,
      });
    }
  }

  for (const [id, action] of Object.entries(actions)) {
    const tenantId = String(action?.tenantId || "");
    if (!tenantId) issue(errors, "action_missing_tenant", { id });
    if (!action?.status) issue(errors, "action_missing_status", { id });
    if (action?.opportunityId) {
      const expected = opportunityTenant.get(String(action.opportunityId));
      if (!expected) {
        issue(errors, "action_unknown_opportunity", {
          id,
          opportunityId: String(action.opportunityId),
        });
      } else if (tenantId && tenantId !== expected) {
        issue(errors, "action_cross_tenant_opportunity", {
          id,
          tenantId,
          opportunityId: String(action.opportunityId),
          opportunityTenant: expected,
        });
      }
    }
    if (action?.contactKey) {
      const contactTenant = tenantFromContactKey(action.contactKey);
      if (tenantId && contactTenant && tenantId !== contactTenant) {
        issue(errors, "action_cross_tenant_contact", {
          id,
          tenantId,
          contactRef: safeRef(action.contactKey),
        });
      }
    }
  }

  for (const [opportunityId, row] of Object.entries(attribution)) {
    const expected = opportunityTenant.get(opportunityId);
    if (!expected) {
      issue(errors, "attribution_unknown_opportunity", { opportunityId });
      continue;
    }
    const tenantId = String(row?.tenantId || expected);
    if (tenantId !== expected) {
      issue(errors, "attribution_cross_tenant_opportunity", {
        opportunityId,
        tenantId,
        opportunityTenant: expected,
      });
    }
  }

  const seenEventIds = new Set();
  const seenEventKeys = new Map();
  const eventKeyMap = object(recovery.eventKeys);

  for (const event of events) {
    const eventId = String(event?.id || "");
    if (!eventId) issue(errors, "event_missing_id");
    if (eventId && seenEventIds.has(eventId)) {
      issue(errors, "duplicate_event_id", { eventId });
    }
    if (eventId) seenEventIds.add(eventId);

    const idempotencyKey = String(event?.idempotencyKey || "");
    if (idempotencyKey) {
      const priorEventId = seenEventKeys.get(idempotencyKey);
      if (priorEventId && priorEventId !== eventId) {
        issue(errors, "duplicate_event_idempotency_key", {
          keyRef: safeRef(idempotencyKey),
          eventIds: [priorEventId, eventId],
        });
      } else {
        seenEventKeys.set(idempotencyKey, eventId);
      }
      if (eventKeyMap[idempotencyKey] && String(eventKeyMap[idempotencyKey]) !== eventId) {
        issue(errors, "event_key_map_mismatch", {
          keyRef: safeRef(idempotencyKey),
          eventId,
          mappedEventId: String(eventKeyMap[idempotencyKey]),
        });
      }
    }
    if (!event?.occurredAt) issue(errors, "event_missing_occurred_at", { eventId });
    let tenantId = String(event?.tenantId || "");
    if (!tenantId && event?.opportunityId) {
      tenantId = opportunityTenant.get(String(event.opportunityId)) || "";
    }
    if (!tenantId && event?.contactKey) {
      tenantId = tenantFromContactKey(event.contactKey);
    }
    if (!tenantId && eventId) {
      tenantId = sourceEventTenant.get(eventId) || "";
    }
    if (!tenantId) {
      issue(warnings, "event_tenant_inferred_later_or_unknown", {
        eventId,
        type: String(event?.type || ""),
      });
    }
    if (event?.opportunityId) {
      const expected = opportunityTenant.get(String(event.opportunityId));
      if (expected && tenantId && expected !== tenantId) {
        issue(errors, "event_cross_tenant_opportunity", {
          eventId,
          tenantId,
          opportunityId: String(event.opportunityId),
          opportunityTenant: expected,
        });
      }
    }
  }

  for (const [eventKey, mappedEventId] of Object.entries(eventKeyMap)) {
    if (!seenEventIds.has(String(mappedEventId))) {
      issue(errors, "event_key_unknown_event", {
        keyRef: safeRef(eventKey),
        mappedEventId: String(mappedEventId),
      });
    }
  }

  for (const [callId, call] of Object.entries(historyCalls)) {
    const tenantId = String(call?.tenantId || "");
    if (!tenantId) issue(errors, "call_history_missing_tenant", { callId });
    if (!call?.updatedAt && !call?.startedAt) {
      issue(warnings, "call_history_missing_timestamp", { callId });
    }
    const control = controlCalls[callId];
    if (control?.tenantId && tenantId && control.tenantId !== tenantId) {
      issue(errors, "call_state_cross_tenant_mismatch", {
        callId,
        controlTenant: String(control.tenantId),
        historyTenant: tenantId,
      });
    }
  }

  for (const [callId, call] of Object.entries(controlCalls)) {
    const tenantId = String(call?.tenantId || "");
    if (!tenantId) issue(warnings, "call_control_missing_tenant", { callId });
    if (!call?.updatedAt) issue(warnings, "call_control_missing_updated_at", { callId });
  }

  for (const lead of leads) {
    const tenantId = String(lead?.tenant_id || lead?.tenantId || "");
    if (!tenantId) issue(errors, "lead_missing_tenant");
    const callId = String(lead?.call_id || lead?.callId || "");
    if (callId && historyCalls[callId]?.tenantId && tenantId &&
        historyCalls[callId].tenantId !== tenantId) {
      issue(errors, "lead_cross_tenant_call", {
        callId,
        tenantId,
        callTenant: String(historyCalls[callId].tenantId),
      });
    }
  }

  for (const [sessionId, session] of Object.entries(sessions)) {
    const tenantId = String(session?.tenantId || "");
    if (!tenantId) issue(errors, "web_chat_missing_tenant", { sessionId });
    if (session?.opportunityId) {
      const expected = opportunityTenant.get(String(session.opportunityId));
      if (!expected) {
        issue(warnings, "web_chat_unknown_opportunity", {
          sessionId,
          opportunityId: String(session.opportunityId),
        });
      } else if (tenantId && tenantId !== expected) {
        issue(errors, "web_chat_cross_tenant_opportunity", {
          sessionId,
          tenantId,
          opportunityId: String(session.opportunityId),
          opportunityTenant: expected,
        });
      }
    }
  }

  for (const [transferId, transfer] of Object.entries(transferRecords)) {
    if (!transfer || typeof transfer !== "object") continue;
    const tenantId = String(transfer.tenantId || "");
    if (!tenantId) issue(warnings, "transfer_missing_tenant", { transferId });
    if (transfer.callId && historyCalls[transfer.callId]?.tenantId && tenantId &&
        historyCalls[transfer.callId].tenantId !== tenantId) {
      issue(errors, "transfer_cross_tenant_call", {
        transferId,
        callId: String(transfer.callId),
        tenantId,
        callTenant: String(historyCalls[transfer.callId].tenantId),
      });
    }
  }

  for (const [id, ts] of Object.entries(processedWebhooks)) {
    if (!Number.isFinite(Number(ts)) || Number(ts) <= 0) {
      issue(errors, "webhook_invalid_timestamp", { webhookId: id });
    }
  }

  for (const [key, value] of Object.entries(metricCounts)) {
    if (!Number.isFinite(Number(value)) || Number(value) < 0) {
      issue(errors, "growth_metric_invalid_count", { key });
    }
  }

  if (billingTest && billingTest.mode && billingTest.mode !== "test") {
    issue(errors, "billing_test_mode_mismatch", { mode: String(billingTest.mode) });
  }
  if (billingLive && billingLive.mode && billingLive.mode !== "live") {
    issue(errors, "billing_live_mode_mismatch", { mode: String(billingLive.mode) });
  }

  const counts = {
    processedWebhooks: Object.keys(processedWebhooks).length,
    callControlRecords: Object.keys(controlCalls).length,
    voiceCalls: Object.keys(historyCalls).length,
    callTurns: Object.values(historyCalls).reduce(
      (sum, call) => sum + array(call?.transcript).length, 0
    ),
    leads: leads.length,
    contacts: Object.keys(contacts).length,
    opportunities: Object.keys(opportunities).length,
    recoveryEvents: events.length,
    recoveryActions: Object.keys(actions).length,
    attributionRecords: Object.keys(attribution).length,
    webChatSessions: Object.keys(sessions).length,
    transferRecords: Object.keys(transferRecords).length,
    growthMetricKeys: Object.keys(metricCounts).length,
    billingTestPresent: Boolean(billingTest),
    billingLivePresent: Boolean(billingLive),
  };

  return {
    ok: errors.length === 0,
    counts,
    errors,
    warnings,
    snapshotFingerprint: stableHash({
      state,
      recovery,
      callHistory,
      webChat,
      transfers,
      growth,
      leads,
      billingTest,
      billingLive,
    }),
  };
}

export function buildPostgresMigrationManifest(snapshot = {}) {
  const audit = auditPostgresMigrationSnapshot(snapshot);
  if (!audit.ok) {
    const error = new Error("postgres_migration_snapshot_invalid");
    error.audit = audit;
    throw error;
  }

  const recovery = object(snapshot.recovery);
  const callHistory = object(snapshot.callHistory);
  const state = object(snapshot.state);
  const webChat = object(snapshot.webChat);
  const transfers = object(snapshot.transfers);
  const opportunities = object(recovery.opportunities);
  const opportunityTenant = new Map(
    Object.entries(opportunities).map(([id, value]) => [id, String(value?.tenantId || "")])
  );

  const sourceEventTenant = new Map();
  for (const opportunity of Object.values(opportunities)) {
    if (opportunity?.sourceEventId && opportunity?.tenantId) {
      sourceEventTenant.set(String(opportunity.sourceEventId), String(opportunity.tenantId));
    }
  }

  const eventTenant = event =>
    String(event?.tenantId || "") ||
    opportunityTenant.get(String(event?.opportunityId || "")) ||
    tenantFromContactKey(event?.contactKey) ||
    sourceEventTenant.get(String(event?.id || "")) ||
    null;

  return {
    version: 1,
    counts: audit.counts,
    snapshotFingerprint: audit.snapshotFingerprint,
    rows: {
      webhookReceipts: Object.entries(object(state.processedWebhooks)).map(([webhookId, receivedAt]) => ({
        webhookId,
        receivedAt: new Date(Number(receivedAt)).toISOString(),
      })),
      callControlState: Object.entries(object(state.calls)).map(([callId, payload]) => ({
        callId,
        tenantId: payload?.tenantId || null,
        updatedAt: payload?.updatedAt ? new Date(Number(payload.updatedAt)).toISOString() : null,
        payload,
      })),
      voiceCalls: Object.entries(object(callHistory.calls)).map(([callId, payload]) => ({
        callId,
        tenantId: String(payload?.tenantId || ""),
        startedAt: payload?.startedAt ? new Date(Number(payload.startedAt)).toISOString() : null,
        endedAt: payload?.endedAt ? new Date(Number(payload.endedAt)).toISOString() : null,
        updatedAt: payload?.updatedAt ? new Date(Number(payload.updatedAt)).toISOString() : null,
        callerMasked: payload?.callerMasked || null,
        dialedMasked: payload?.dialedMasked || null,
        transferred: Boolean(payload?.transferred),
        spamEnded: Boolean(payload?.spamEnded),
        payload,
      })),
      callTurns: Object.entries(object(callHistory.calls)).flatMap(([callId, payload]) =>
        array(payload?.transcript).map((turn, index) => ({
          callId,
          sequenceNo: index,
          speaker: turn?.speaker === "assistant" ? "assistant" : "caller",
          itemId: turn?.itemId || null,
          occurredAt: turn?.at || null,
          textContent: String(turn?.text || ""),
        }))
      ),
      leads: array(snapshot.leads).map(payload => ({
        sourceKey: stableHash(payload),
        tenantId: String(payload?.tenant_id || payload?.tenantId || ""),
        callId: payload?.call_id || payload?.callId || null,
        capturedAt: payload?.captured_at || payload?.capturedAt || payload?.timestamp || null,
        payload,
      })),
      contacts: Object.entries(object(recovery.contacts)).map(([contactKey, payload]) => ({
        contactKey,
        tenantId: String(payload?.tenantId || tenantFromContactKey(contactKey)),
        updatedAt: payload?.updatedAt || null,
        payload,
      })),
      opportunities: Object.entries(opportunities).map(([opportunityId, payload]) => ({
        opportunityId,
        tenantId: String(payload?.tenantId || ""),
        contactKey: payload?.contactKey || null,
        status: String(payload?.status || ""),
        createdAt: payload?.createdAt || null,
        updatedAt: payload?.updatedAt || null,
        payload,
      })),
      recoveryEvents: array(recovery.events).map((payload, sourceSequence) => ({
        eventId: String(payload?.id || ""),
        sourceSequence,
        tenantId: eventTenant(payload),
        idempotencyKey: payload?.idempotencyKey || null,
        opportunityId: payload?.opportunityId || null,
        contactKey: payload?.contactKey || null,
        occurredAt: payload?.occurredAt || null,
        payload,
      })),
      recoveryEventKeys: Object.entries(object(recovery.eventKeys)).map(([eventKey, eventId]) => {
        const event = array(recovery.events).find(item => String(item?.id || "") === String(eventId));
        return {
          tenantId: event ? eventTenant(event) : null,
          eventKey,
          eventId: String(eventId),
        };
      }),
      recoveryActions: Object.entries(object(recovery.actions)).map(([actionId, payload]) => ({
        actionId,
        tenantId: String(payload?.tenantId || ""),
        opportunityId: payload?.opportunityId || null,
        contactKey: payload?.contactKey || null,
        channel: payload?.channel || null,
        status: String(payload?.status || ""),
        dueAt: payload?.dueAt || null,
        claimedBy: payload?.claimedBy || null,
        claimedAt: payload?.claimedAt || null,
        claimExpiresAt: payload?.claimExpiresAt || null,
        createdAt: payload?.createdAt || null,
        completedAt: payload?.completedAt || null,
        payload,
      })),
      attribution: Object.entries(object(recovery.attribution)).map(([opportunityId, payload]) => ({
        opportunityId,
        tenantId: String(payload?.tenantId || opportunityTenant.get(opportunityId) || ""),
        updatedAt: payload?.updatedAt || null,
        payload,
      })),
      webChatSessions: Object.entries(object(webChat.sessions)).map(([sessionId, payload]) => ({
        sessionId,
        tenantId: String(payload?.tenantId || ""),
        opportunityId: payload?.opportunityId || null,
        createdAt: payload?.createdAt ? new Date(Number(payload.createdAt)).toISOString() : null,
        updatedAt: payload?.updatedAt ? new Date(Number(payload.updatedAt)).toISOString() : null,
        payload,
      })),
      transferRecords: Object.entries(transfers.calls || transfers.records || transfers)
        .filter(([, payload]) => payload && typeof payload === "object")
        .map(([transferId, payload]) => ({
          transferId,
          tenantId: payload?.tenantId || null,
          callId: payload?.callId || null,
          status: payload?.status || null,
          updatedAt: payload?.updatedAt ? new Date(Number(payload.updatedAt)).toISOString() : null,
          payload,
        })),
      transferWebhookReceipts: Object.entries(object(transfers.processedWebhooks)).map(([webhookId, receivedAt]) => ({
        webhookId,
        receivedAt: new Date(Number(receivedAt)).toISOString(),
      })),
      growthMetrics: Object.entries(object(snapshot.growthMetrics?.counts)).map(([metricKey, count]) => ({
        metricKey,
        metricCount: Number(count),
        updatedAt: snapshot.growthMetrics?.updatedAt || null,
        payload: { key: metricKey, count: Number(count) },
      })),
      billingState: [
        ...(snapshot.billingTest ? [{ mode: "test", payload: snapshot.billingTest }] : []),
        ...(snapshot.billingLive ? [{ mode: "live", payload: snapshot.billingLive }] : []),
      ],
    },
  };
}
