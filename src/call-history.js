import fs from "node:fs/promises";
import path from "node:path";

function clean(value, max = 4000) {
  return String(value ?? "").trim().slice(0, max);
}

function redactSensitive(text) {
  return clean(text, 8000)
    .replace(/\b\d{3}[- ]?\d{2}[- ]?\d{4}\b/g, "[REDACTED_SSN]")
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, "[REDACTED_PAYMENT_NUMBER]");
}

export class CallHistoryStore {
  constructor(filePath, { retentionDays = 30 } = {}) {
    this.filePath = path.resolve(filePath);
    this.retentionDays = Number(retentionDays) || 30;
    this.data = { calls: {} };
    this.loaded = false;
    this.writeChain = Promise.resolve();
  }

  async load() {
    if (this.loaded) return;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      this.data = { calls: parsed.calls || {} };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    this.loaded = true;
    await this.prune();
  }

  async persist() {
    await this.load();
    const temp = `${this.filePath}.tmp`;
    const body = JSON.stringify(this.data, null, 2);
    this.writeChain = this.writeChain.then(async () => {
      await fs.writeFile(temp, body, "utf8");
      await fs.rename(temp, this.filePath);
    });
    return this.writeChain;
  }

  async prune(now = Date.now()) {
    await this.loadWithoutPrune();
    const cutoff = now - this.retentionDays * 24 * 60 * 60 * 1000;
    let changed = false;
    for (const [id, call] of Object.entries(this.data.calls)) {
      const ts = Number(call.updatedAt || call.startedAt || 0);
      if (ts && ts < cutoff) {
        delete this.data.calls[id];
        changed = true;
      }
    }
    if (changed) await this.persist();
  }

  async loadWithoutPrune() {
    if (this.loaded) return;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      this.data = { calls: parsed.calls || {} };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    this.loaded = true;
  }

  async start(callId, { tenantId, callerMasked = "", dialedMasked = "" } = {}) {
    await this.load();
    const now = Date.now();
    this.data.calls[callId] = {
      ...(this.data.calls[callId] || {}),
      callId,
      tenantId: clean(tenantId, 120),
      callerMasked: clean(callerMasked, 40),
      dialedMasked: clean(dialedMasked, 40),
      startedAt: this.data.calls[callId]?.startedAt || now,
      updatedAt: now,
      transcript: this.data.calls[callId]?.transcript || [],
    };
    await this.persist();
    return this.data.calls[callId];
  }

  async addTurn(callId, { speaker, text, itemId = "" } = {}) {
    await this.load();
    const call = this.data.calls[callId];
    if (!call) return null;
    const safeText = redactSensitive(text);
    if (!safeText) return call;
    call.transcript ??= [];
    call.transcript.push({
      speaker: speaker === "assistant" ? "assistant" : "caller",
      text: safeText,
      itemId: clean(itemId, 160),
      at: new Date().toISOString(),
    });
    if (call.transcript.length > 200) call.transcript = call.transcript.slice(-200);
    call.updatedAt = Date.now();
    await this.persist();
    return call;
  }

  async finish(callId, patch = {}) {
    await this.load();
    const call = this.data.calls[callId];
    if (!call) return null;
    const now = Date.now();
    Object.assign(call, {
      ...patch,
      endedAt: patch.endedAt || now,
      updatedAt: now,
    });
    await this.persist();
    return call;
  }

  async list(tenantId, { q = "", limit = 50 } = {}) {
    await this.load();
    const needle = clean(q, 200).toLowerCase();
    return Object.values(this.data.calls)
      .filter(call => call.tenantId === tenantId)
      .filter(call => !needle || [
        call.callerMasked,
        ...(call.transcript || []).map(turn => turn.text),
      ].join(" ").toLowerCase().includes(needle))
      .sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0))
      .slice(0, Math.min(Math.max(Number(limit) || 50, 1), 100))
      .map(call => ({
        callId: call.callId,
        tenantId: call.tenantId,
        callerMasked: call.callerMasked,
        dialedMasked: call.dialedMasked,
        startedAt: call.startedAt,
        endedAt: call.endedAt || null,
        transferred: Boolean(call.transferred),
        spamEnded: Boolean(call.spamEnded),
        transcriptTurns: (call.transcript || []).length,
        preview: (call.transcript || []).slice(-2).map(turn => `${turn.speaker}: ${turn.text}`).join(" ").slice(0, 500),
      }));
  }

  async stats(tenantId) {
    await this.load();
    const calls = Object.values(this.data.calls).filter(call => call.tenantId === tenantId);
    return {
      callsHandled: calls.length,
      humanTransfers: calls.filter(call => call.transferred).length,
      spamScreened: calls.filter(call => call.spamEnded).length,
      callsWithTranscript: calls.filter(call => (call.transcript || []).length > 0).length,
    };
  }

  async get(tenantId, callId) {
    await this.load();
    const call = this.data.calls[callId];
    return call?.tenantId === tenantId ? structuredClone(call) : null;
  }
}
