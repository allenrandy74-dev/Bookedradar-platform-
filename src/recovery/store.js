import { dispatchAllowed } from "./dispatch-policy.js";
import { recipientSuppressed } from "./engine.js";
import { transactionalJsonStore, immutableOwnership } from "../json-file-transaction.js";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function eventOwner(data, event) {
  const candidates = new Set();
  if (event.tenantId) candidates.add(event.tenantId);
  const direct = data.opportunities[event.opportunityId];
  if (direct?.tenantId) candidates.add(direct.tenantId);
  if (event.id) for (const opportunity of Object.values(data.opportunities)) {
    if (opportunity.sourceEventId === event.id && opportunity.tenantId) candidates.add(opportunity.tenantId);
  }
  const contact = data.contacts[event.contactKey];
  if (contact?.tenantId) candidates.add(contact.tenantId);
  if (candidates.size > 1) throw new Error("event_owner_ambiguous");
  return [...candidates][0];
}

const EVENT_KEY_FORMAT = "tenant_scoped_v1";
const scopedKey = (tenantId, rawKey) => JSON.stringify([tenantId || "", rawKey]);

function decodeScopedKey(key) {
  let tuple;
  try { tuple = JSON.parse(key); } catch { return null; }
  return Array.isArray(tuple) && tuple.length === 2 && tuple.every(value => typeof value === "string")
    ? tuple : null;
}

function normalizeEventOwners(data) {
  if (data.eventKeyFormat !== undefined && data.eventKeyFormat !== EVENT_KEY_FORMAT) {
    throw new Error("event_key_format_invalid");
  }
  const marked = data.eventKeyFormat === EVENT_KEY_FORMAT;
  const events = data.events.map(event => {
    const tenantId = eventOwner(data, event);
    return tenantId && !event.tenantId ? { ...event, tenantId } : event;
  });
  const byId = new Map();
  for (const event of events) {
    if (!event.id || byId.has(event.id)) throw new Error("event_id_conflict");
    byId.set(event.id, event);
  }
  const keys = Object.create(null), indexed = new Set();
  const put = (key, eventId) => {
    if (Object.hasOwn(keys, key) && keys[key] !== eventId) throw new Error("event_key_conflict");
    keys[key] = eventId;
  };
  for (const [key, eventId] of Object.entries(data.eventKeys || {})) {
    const event = byId.get(eventId);
    if (!event) throw new Error("event_key_unknown_event");
    const owner = event.tenantId || "";
    let rawKey = key;
    if (marked) {
      const tuple = decodeScopedKey(key);
      if (!tuple || !tuple[1]) throw new Error("event_key_format_invalid");
      if (tuple[0] !== owner) throw new Error("event_key_owner_conflict");
      rawKey = tuple[1];
    } else if (key !== event.idempotencyKey && key !== event.id && decodeScopedKey(key)) {
      // A tuple-looking string can be a literal source key or old encoded key.
      // Only an exact payload key proves the former without a format marker.
      throw new Error("event_key_format_ambiguous");
    }
    if (!rawKey) throw new Error("event_key_format_invalid");
    put(scopedKey(owner, rawKey), eventId);
    indexed.add(eventId);
  }
  // Preserve explicit aliases and their count. Repair only wholly unindexed
  // receipts; canonical payload lookup below needs no extra persisted alias.
  const canonical = new Map();
  for (const event of events) {
    const rawKey = event.idempotencyKey || event.id;
    if (typeof rawKey !== "string" || !rawKey) throw new Error("event_key_format_invalid");
    const key = scopedKey(event.tenantId, rawKey);
    if ((canonical.has(key) && canonical.get(key) !== event.id) ||
        (Object.hasOwn(keys, key) && keys[key] !== event.id)) throw new Error("event_key_conflict");
    canonical.set(key, event.id);
    if (!indexed.has(event.id)) put(key, event.id);
  }
  data.events = events;
  data.eventKeys = keys;
  data.eventKeyFormat = EVENT_KEY_FORMAT;
}

function eventForKey(data, rawKey, tenantId) {
  const owner = tenantId || "";
  if (owner && (Object.hasOwn(data.eventKeys, scopedKey("", rawKey)) ||
      data.events.some(event => !event.tenantId && (event.idempotencyKey || event.id) === rawKey))) {
    throw new Error("event_owner_unresolved");
  }
  const eventId = data.eventKeys[scopedKey(owner, rawKey)];
  if (eventId) return data.events.find(event => event.id === eventId && (event.tenantId || "") === owner);
  return data.events.find(event => (event.tenantId || "") === owner && (event.idempotencyKey || event.id) === rawKey);
}

export class RecoveryStore {
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
    this.data = {
      opportunities: {},
      actions: {},
      events: [],
      eventKeys: {},
      eventKeyFormat: EVENT_KEY_FORMAT,
      contacts: {},
      attribution: {},
    };
    this.loaded = false;
  }

  async load() {
    if (this.loaded) { normalizeEventOwners(this.data); return; }
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      this.data = {
        opportunities: parsed.opportunities || {},
        actions: parsed.actions || {},
        events: parsed.events || [],
        eventKeys: parsed.eventKeys || {},
        ...(parsed.eventKeyFormat !== undefined ? { eventKeyFormat: parsed.eventKeyFormat } : {}),
        contacts: parsed.contacts || {},
        attribution: parsed.attribution || {},
      };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    normalizeEventOwners(this.data);
    this.loaded = true;
  }

  // Replaced by transactionalJsonStore during module initialization. Keeping
  // persistence unavailable until that wrapper is installed prevents accidental
  // reintroduction of unfenced cached-snapshot writes.
  async persist() { throw new Error("transactional_json_initialization_required"); }

  async addEvent(event) {
    await this.load();
    const opportunityOwner = eventOwner(this.data, event);
    if (event.tenantId && opportunityOwner && event.tenantId !== opportunityOwner) throw new Error("event_tenant_conflict");
    if (!event.tenantId && opportunityOwner) event = { ...event, tenantId: opportunityOwner };
    const rawKey = event.idempotencyKey || event.id || null;
    if (rawKey !== null && (typeof rawKey !== "string" || !rawKey)) throw new Error("event_key_format_invalid");
    const existing = rawKey && eventForKey(this.data, rawKey, event.tenantId);
    if (existing) return { ...existing, duplicate: true };
    if (event.id && this.data.events.some(item => item.id === event.id)) throw new Error("event_id_conflict");

    const item = {
      id: event.id || id("evt"),
      occurredAt: event.occurredAt || new Date().toISOString(),
      ...event,
    };

    this.data.events.push(item);
    this.data.eventKeys[scopedKey(item.tenantId, item.idempotencyKey || item.id)] = item.id;
    await this.persist();
    return item;
  }

  async hasEventKey(key, tenantId) {
    await this.load();
    return Boolean(eventForKey(this.data, key, tenantId));
  }

  async finishClaim(actionId, claim, patch, now = new Date()) {
    await this.load();
    const current = this.data.actions[actionId];
    if (!current || !["processing", "dispatching"].includes(current.status) ||
        current.tenantId !== claim?.tenantId || current.claimedBy !== claim?.claimedBy ||
        current.claimedAt !== claim?.claimedAt || current.claimExpiresAt !== claim?.claimExpiresAt ||
        !(new Date(current.claimExpiresAt) > now)) throw new Error("stale_recovery_claim");
    if (!patch || !["completed", "failed", "blocked", "pending", "reconciliation_required"].includes(patch.status) ||
        ["id", "tenantId", "claimedBy", "claimedAt", "claimExpiresAt", "opportunityId", "contactKey"].some(k => k in patch)) throw new Error("action_patch_invalid");
    if (current.status === "dispatching" && patch.status === "pending") throw new Error("dispatch_reconciliation_required");
    return this.patchAction(actionId, { ...patch, claimedBy: null, claimedAt: null, claimExpiresAt: null });
  }

  async beginDispatch(actionId, claim, now = new Date(), tenant = null) {
    await this.load();
    const current = this.data.actions[actionId];
    if (!current || current.status !== "processing" || current.tenantId !== claim?.tenantId ||
        current.claimedBy !== claim?.claimedBy || current.claimedAt !== claim?.claimedAt ||
        current.claimExpiresAt !== claim?.claimExpiresAt || !(new Date(current.claimExpiresAt) > now)) throw new Error("stale_recovery_claim");
    if (!tenant || tenant.tenantId !== current.tenantId) throw new Error("dispatch_tenant_mismatch");
    const contact = await this.getContact(current.contactKey);
    const opportunity = await this.getOpportunity(current.opportunityId);
    const decision = dispatchAllowed({ action: current, opportunity, contact, tenant, now });
    if (await recipientSuppressed(this, tenant.tenantId, contact)) { decision.allowed = false; decision.reason = "contact_suppressed"; }
    if (current.expectedRecipient && current.expectedRecipient !== contact?.phone) { decision.allowed = false; decision.reason = "sms_recipient_changed"; }
    if (!decision.allowed) return this.patchAction(actionId, { status: "blocked", blockedReason: decision.reason,
      completedAt: now.toISOString(), claimedBy: null, claimedAt: null, claimExpiresAt: null });
    const intent = await this.patchAction(actionId, { status: "dispatching", dispatchStartedAt: now.toISOString() });
    return { ...intent, dispatchContact: contact };
  }

  async upsertContact(contactKey, patch) {
    await this.load();
    patch = { ...patch };
    for (const key of ["name", "firstName", "lastName"]) {
      if (patch[key] == null || String(patch[key]).trim() === "") delete patch[key];
    }
    immutableOwnership(this.data.contacts[contactKey], patch, ["tenantId", "contactKey"]);
    this.data.contacts[contactKey] = {
      ...(this.data.contacts[contactKey] || {}),
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    await this.persist();
    return this.data.contacts[contactKey];
  }

  async getContact(contactKey) {
    await this.load();
    return this.data.contacts[contactKey] || null;
  }

  async createOpportunity(opportunity) {
    await this.load();
    const opportunityId = opportunity.id || id("opp");
    immutableOwnership(this.data.opportunities[opportunityId], opportunity);
    if (this.data.opportunities[opportunityId]) throw new Error("opportunity_already_exists");
    const item = {
      id: opportunityId,
      status: "open",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...opportunity,
      id: opportunityId,
    };
    this.data.opportunities[opportunityId] = item;
    await this.persist();
    return item;
  }

  async getOpportunity(opportunityId) {
    await this.load();
    return this.data.opportunities[opportunityId] || null;
  }

  async patchOpportunity(opportunityId, patch) {
    await this.load();
    const prior = this.data.opportunities[opportunityId];
    if (!prior) throw new Error(`Unknown opportunity: ${opportunityId}`);
    immutableOwnership(prior, patch, ["tenantId", "id", "contactKey"]);
    this.data.opportunities[opportunityId] = {
      ...prior,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    await this.persist();
    return this.data.opportunities[opportunityId];
  }

  async scheduleAction(action) {
    await this.load();
    const actionId = action.id || id("act");
    immutableOwnership(this.data.actions[actionId], action);
    if (this.data.actions[actionId]) throw new Error("action_already_exists");
    const item = {
      id: actionId,
      status: action.status || "pending",
      createdAt: new Date().toISOString(),
      ...action,
      id: actionId,
    };
    this.data.actions[actionId] = item;
    await this.persist();
    return item;
  }

  async dueActions(now = new Date()) {
    await this.load();
    const cutoff = now.getTime();
    return Object.values(this.data.actions).filter((action) =>
      action.status === "pending" &&
      new Date(action.dueAt).getTime() <= cutoff
    );
  }

  async claimDueActions({
    now = new Date(),
    workerId = `worker_${process.pid}`,
    limit = 50,
    leaseMs = 5 * 60 * 1000,
    tenantId = "",
  } = {}) {
    await this.load();

    // Recover abandoned claims after lease expiry.
    const nowMs = now.getTime();
    for (const action of Object.values(this.data.actions)) {
      if (
        action.status === "processing" &&
        action.claimExpiresAt &&
        new Date(action.claimExpiresAt).getTime() <= nowMs
      ) {
        action.status = "pending";
        delete action.claimedBy;
        delete action.claimedAt;
        delete action.claimExpiresAt;
      }
    }

    const eligible = Object.values(this.data.actions)
      .filter((action) =>
        action.status === "pending" &&
        (!tenantId || action.tenantId === tenantId) &&
        new Date(action.dueAt).getTime() <= nowMs
      )
      .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt))
      .slice(0, limit);

    for (const action of eligible) {
      action.status = "processing";
      action.claimedBy = workerId;
      action.claimedAt = now.toISOString();
      action.claimExpiresAt = new Date(nowMs + leaseMs).toISOString();
    }

    if (eligible.length) await this.persist();
    return structuredClone(eligible);
  }

  async patchAction(actionId, patch) {
    await this.load();
    const prior = this.data.actions[actionId];
    if (!prior) throw new Error(`Unknown action: ${actionId}`);
    immutableOwnership(prior, patch, ["tenantId", "id", "opportunityId", "contactKey"]);
    if (["dispatching", "reconciliation_required", "completed", "failed", "blocked", "cancelled"].includes(prior.status) &&
        ["pending", "processing"].includes(patch.status)) throw new Error("action_reenable_forbidden");
    this.data.actions[actionId] = { ...prior, ...patch };
    await this.persist();
    return this.data.actions[actionId];
  }


  async cancelPendingActions(
    opportunityId,
    {
      channels = ["sms", "email"],
      reason = "cancelled_by_event",
    } = {}
  ) {
    await this.load();
    let changed = 0;

    for (const action of Object.values(this.data.actions)) {
      if (
        action.opportunityId === opportunityId &&
        ["pending", "processing"].includes(action.status) &&
        channels.includes(action.channel)
      ) {
        action.status = "cancelled";
        action.cancelledReason = reason;
        action.completedAt = new Date().toISOString();
        delete action.claimedBy;
        delete action.claimedAt;
        delete action.claimExpiresAt;
        changed += 1;
      }
    }

    if (changed) await this.persist();
    return changed;
  }

  async putAttribution(opportunityId, patch) {
    await this.load();
    immutableOwnership(this.data.attribution[opportunityId], patch, ["tenantId", "opportunityId"]);
    immutableOwnership(this.data.opportunities[opportunityId], patch, ["tenantId"]);
    this.data.attribution[opportunityId] = {
      ...(this.data.attribution[opportunityId] || {}),
      ...patch,
      opportunityId,
      updatedAt: new Date().toISOString(),
    };
    await this.persist();
    return this.data.attribution[opportunityId];
  }

  async failedActions(tenantId = "") {
    await this.load();
    return Object.values(this.data.actions)
      .filter((action) => action.status === "failed" && (!tenantId || action.tenantId === tenantId))
      .sort((a, b) => String(b.completedAt || b.createdAt).localeCompare(String(a.completedAt || a.createdAt)));
  }

  async prune({
    now = new Date(),
    eventRetentionDays = 90,
    actionRetentionDays = 180,
  } = {}) {
    await this.load();
    const nowMs = now.getTime();
    const eventCutoff = nowMs - Number(eventRetentionDays) * 24 * 60 * 60 * 1000;
    const actionCutoff = nowMs - Number(actionRetentionDays) * 24 * 60 * 60 * 1000;

    const beforeEvents = this.data.events.length;
    const keptEvents = [];
    const keptKeys = {};
    for (const event of this.data.events) {
      const occurred = new Date(event.occurredAt || 0).getTime();
      if (occurred >= eventCutoff) {
        keptEvents.push(event);

      }
    }
    const keptIds = new Set(keptEvents.map(event => event.id));
    for (const [key, eventId] of Object.entries(this.data.eventKeys)) {
      if (keptIds.has(eventId)) keptKeys[key] = eventId;
    }
    this.data.events = keptEvents;
    this.data.eventKeys = keptKeys;

    let deletedActions = 0;
    for (const [id, action] of Object.entries(this.data.actions)) {
      if (!["completed", "failed", "blocked", "cancelled"].includes(action.status)) continue;
      const date = new Date(action.completedAt || action.createdAt || 0).getTime();
      if (date < actionCutoff) {
        delete this.data.actions[id];
        deletedActions++;
      }
    }

    await this.persist();
    return {
      deletedEvents: beforeEvents - keptEvents.length,
      deletedActions,
    };
  }

  async snapshot() {
    await this.load();
    return structuredClone(this.data);
  }
}

transactionalJsonStore(RecoveryStore, "data");
