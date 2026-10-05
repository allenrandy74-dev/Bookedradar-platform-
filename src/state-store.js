import crypto from "node:crypto";
import { transactionalJsonStore, immutableOwnership } from "./json-file-transaction.js";
import fs from "node:fs/promises";
import path from "node:path";

export class JsonStateStore {
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
    this.state = { processedWebhooks: {}, calls: {}, attempts: {} };
    this.loaded = false;
  }
  async load() {
    if (this.loaded) return;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      this.state.processedWebhooks = parsed.processedWebhooks || {};
      this.state.calls = parsed.calls || {};
      this.state.attempts = parsed.attempts || {};
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    this.loaded = true;
    await this.prune();
  }
  // Replaced by transactionalJsonStore during module initialization. Keeping
  // persistence unavailable until that wrapper is installed prevents accidental
  // reintroduction of unfenced cached-snapshot writes.
  async persist() { throw new Error("transactional_json_initialization_required"); }

  async prune(now = Date.now()) {
    const webhookCutoff = now - 24 * 60 * 60 * 1000;
    const callCutoff = now - 30 * 24 * 60 * 60 * 1000;
    for (const [id, ts] of Object.entries(this.state.processedWebhooks)) if (Number(ts) < webhookCutoff) delete this.state.processedWebhooks[id];
    for (const [id, value] of Object.entries(this.state.calls)) if (Number(value?.updatedAt || 0) < callCutoff) delete this.state.calls[id];
  }
  async hasInquiryReceipt(id) {
    await this.load();
    return Number(this.state.processedWebhooks[id] || 0) >= Date.now() - 24 * 60 * 60 * 1000;
  }
  // Inquiry TTL is scoped here; preserve existing voice-webhook semantics.
  async markInquiryOnce(id) {
    await this.load();
    if (!id) throw new Error("inquiry_key_required");
    if (Number(this.state.processedWebhooks[id] || 0) < Date.now() - 24 * 60 * 60 * 1000) {
      delete this.state.processedWebhooks[id];
    }
    return this.markWebhookOnce(id);
  }
  async markWebhookOnce(id) {
    await this.load();
    if (!id) return true;
    if (this.state.processedWebhooks[id]) return false;
    this.state.processedWebhooks[id] = Date.now();
    await this.persist();
    return true;
  }
  async releaseWebhook(id) {
    await this.load();
    if (!id || !this.state.processedWebhooks[id]) return false;
    delete this.state.processedWebhooks[id];
    await this.persist();
    return true;
  }
  async claimAttempt(key, intent) {
    await this.load();
    if (typeof key !== "string" || !key || ["tenantId", "callId", "target", "kind", "fingerprint"].some(name => typeof intent?.[name] !== "string" || !intent[name].trim())) throw new Error("attempt_identity_required");
    const identity = Object.fromEntries(["tenantId", "callId", "target", "kind", "fingerprint"].map(name => [name, intent[name] ?? null]));
    const prior = this.state.attempts[key];
    if (prior) {
      if (!prior.identity || Object.keys(identity).some(name => prior.identity[name] !== identity[name])) throw new Error("attempt_intent_conflict");
      return { claimed: false, record: prior };
    }
    const record = { ...intent, identity, key, claimToken: crypto.randomUUID(), status: "pending", createdAt: new Date().toISOString() };
    this.state.attempts[key] = record;
    await this.persist();
    return { claimed: true, record };
  }
  async finishAttempt(key, patch) {
    await this.load();
    const prior = this.state.attempts[key];
    if (!prior) throw new Error("attempt_not_found");
    if (prior.status !== "pending" || patch?.claimToken !== prior.claimToken ||
        ["tenantId", "callId", "target", "kind", "fingerprint"].some(name => (patch[name] ?? null) !== prior.identity[name])) throw new Error("attempt_claim_conflict");
    if (!["pending", "accepted", "uncertain", "completed", "failed", "reconciliation_required"].includes(patch.status)) throw new Error("attempt_status_invalid");
    immutableOwnership(prior, patch, ["tenantId", "callId", "target", "kind", "fingerprint", "key", "createdAt"]);
    if (Object.hasOwn(patch, "identity")) throw new Error("immutable_attempt_identity");
    const record = { ...prior, ...patch, updatedAt: new Date().toISOString() };
    this.state.attempts[key] = record;
    await this.persist();
    return record;
  }
  async getCall(callId) { await this.load(); return this.state.calls[callId] || null; }
  async patchCall(callId, patch) {
    await this.load();
    immutableOwnership(this.state.calls[callId], patch, ["tenantId", "callId"]);
    this.state.calls[callId] = { ...(this.state.calls[callId] || {}), ...patch, updatedAt: Date.now() };
    await this.persist();
    return this.state.calls[callId];
  }
}


transactionalJsonStore(JsonStateStore, "state");
