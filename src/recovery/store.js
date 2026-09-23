import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export class RecoveryStore {
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
    this.data = {
      opportunities: {},
      actions: {},
      events: [],
      eventKeys: {},
      contacts: {},
      attribution: {},
    };
    this.loaded = false;
    this.writeChain = Promise.resolve();
  }

  async load() {
    if (this.loaded) return;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      this.data = {
        opportunities: parsed.opportunities || {},
        actions: parsed.actions || {},
        events: parsed.events || [],
        eventKeys: parsed.eventKeys || {},
        contacts: parsed.contacts || {},
        attribution: parsed.attribution || {},
      };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    this.loaded = true;
  }

  async persist() {
    await this.load();
    const tmp = `${this.filePath}.tmp`;
    const body = JSON.stringify(this.data, null, 2);
    this.writeChain = this.writeChain.then(async () => {
      await fs.writeFile(tmp, body, "utf8");
      await fs.rename(tmp, this.filePath);
    });
    return this.writeChain;
  }

  async addEvent(event) {
    await this.load();
    const eventKey = event.idempotencyKey || event.id || null;

    if (eventKey && this.data.eventKeys[eventKey]) {
      const existingId = this.data.eventKeys[eventKey];
      const existing = this.data.events.find((item) => item.id === existingId);
      return { ...existing, duplicate: true };
    }

    const item = {
      id: event.id || id("evt"),
      occurredAt: event.occurredAt || new Date().toISOString(),
      ...event,
    };

    this.data.events.push(item);
    if (eventKey) this.data.eventKeys[eventKey] = item.id;
    await this.persist();
    return item;
  }

  async upsertContact(contactKey, patch) {
    await this.load();
    patch = { ...patch };
    for (const key of ["name", "firstName", "lastName"]) {
      if (patch[key] == null || String(patch[key]).trim() === "") delete patch[key];
    }
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
        const key = event.idempotencyKey || event.id;
        if (key) keptKeys[key] = event.id;
      }
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
