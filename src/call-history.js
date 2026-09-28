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

  async addKnowledgeGap(callId, { question = "", category = "business_question" } = {}) {
    await this.load();
    const call = this.data.calls[callId];
    if (!call) return null;
    const text = redactSensitive(question).slice(0, 500);
    if (!text) return call;
    call.knowledgeGaps ??= [];
    const key = text.toLowerCase();
    if (!call.knowledgeGaps.some(item => item.question.toLowerCase() === key)) {
      call.knowledgeGaps.push({
        question: text,
        category: clean(category, 80) || "business_question",
        at: new Date().toISOString(),
      });
      if (call.knowledgeGaps.length > 20) call.knowledgeGaps = call.knowledgeGaps.slice(-20);
    }
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

  async mark(callId, event, fields = {}) {
    await this.load();
    const call = this.data.calls[callId];
    if (!call) return null;
    const key = clean(event, 80).replace(/[^a-zA-Z0-9_.-]/g, "_");
    if (!key) return call;
    const now = Number(fields.at || Date.now());
    call.milestones ??= {};
    const existing = call.milestones[key] || { count: 0 };
    call.milestones[key] = {
      firstAt: existing.firstAt || now,
      lastAt: now,
      count: Number(existing.count || 0) + 1,
      ...(Number.isFinite(Number(fields.latencyMs)) ? { latencyMs: Number(fields.latencyMs) } : {}),
      ...(fields.ok === false ? { ok: false } : {}),
      ...(fields.reason ? { reason: clean(fields.reason, 160) } : {}),
    };
    call.updatedAt = Date.now();
    await this.persist();
    return structuredClone(call.milestones[key]);
  }

  async operationalSummary({ tenantId = "", sinceMs = 0, now = Date.now() } = {}) {
    await this.load();
    const calls = Object.values(this.data.calls).filter(call =>
      (!tenantId || call.tenantId === tenantId) &&
      Number(call.startedAt || 0) >= Number(sinceMs || 0)
    );

    const values = (event, fallback = null) => calls
      .map(call => {
        const milestone = call.milestones?.[event];
        if (milestone && Number.isFinite(Number(milestone.latencyMs))) return Number(milestone.latencyMs);
        if (milestone?.firstAt && fallback === "from_start") {
          return Math.max(0, Number(milestone.firstAt) - Number(call.startedAt || milestone.firstAt));
        }
        return null;
      })
      .filter(Number.isFinite)
      .sort((a, b) => a - b);

    const percentile = (items, p) => {
      if (!items.length) return null;
      const index = Math.min(items.length - 1, Math.max(0, Math.ceil(items.length * p) - 1));
      return items[index];
    };

    const acceptedLatency = values("call.accepted", "from_start");
    const firstAudioLatency = values("greeting.first_audio", "from_start");
    const ended = calls.filter(call => Boolean(call.endedAt));
    const completedWithoutFirstAudio = ended.filter(call => !call.milestones?.["greeting.first_audio"]);
    const usefulLead = calls.filter(call =>
      Boolean(
        call.milestones?.["lead.persisted"] ||
        (call.leadSummary?.serviceType && call.leadSummary?.callback)
      )
    );

    const byTenant = {};
    for (const call of calls) {
      const key = call.tenantId || "unknown";
      byTenant[key] = (byTenant[key] || 0) + 1;
    }

    return {
      generatedAt: new Date(now).toISOString(),
      tenantId: tenantId || null,
      callsStarted: calls.length,
      callsEnded: ended.length,
      callsActive: calls.filter(call => !call.endedAt).length,
      callsAccepted: calls.filter(call => call.milestones?.["call.accepted"]).length,
      callsWithFirstAudio: calls.filter(call => call.milestones?.["greeting.first_audio"]).length,
      callsEndedWithoutFirstAudio: completedWithoutFirstAudio.length,
      usefulLeadCalls: usefulLead.length,
      transferRequests: calls.filter(call => call.milestones?.["transfer.requested"]).length,
      transfersInitiated: calls.filter(call => call.milestones?.["transfer.initiated"] || call.transferred).length,
      greetingFailures: calls.filter(call => call.milestones?.["greeting.failed"]).length,
      greetingFallbacks: calls.filter(call => call.milestones?.["greeting.fallback"]).length,
      realtimeErrors: calls.reduce((sum, call) => sum + Number(call.milestones?.["realtime.error"]?.count || 0), 0),
      latencyMs: {
        acceptP50: percentile(acceptedLatency, 0.50),
        acceptP95: percentile(acceptedLatency, 0.95),
        firstAudioP50: percentile(firstAudioLatency, 0.50),
        firstAudioP95: percentile(firstAudioLatency, 0.95),
      },
      byTenant,
    };
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
        knowledgeGaps: (call.knowledgeGaps || []).length,
        leadSummary: call.leadSummary || null,
        preview: (call.transcript || []).slice(-2).map(turn => `${turn.speaker}: ${turn.text}`).join(" ").slice(0, 500),
      }));
  }

  async statsSince(tenantId, sinceMs = 0) {
    await this.load();
    const calls = Object.values(this.data.calls).filter(call =>
      call.tenantId === tenantId && Number(call.startedAt || 0) >= Number(sinceMs || 0)
    );
    return {
      callsHandled: calls.length,
      humanTransfers: calls.filter(call => call.transferred).length,
      incompleteCalls: calls.filter(call => {
        const lead = call.leadSummary || {};
        return !lead.serviceType || !lead.callback || !lead.urgency || !lead.preferredWindow;
      }).length,
      callsWithUsefulLead: calls.filter(call => Boolean(call.leadSummary?.serviceType && call.leadSummary?.callback)).length,
      firstUsefulLeadAt: calls
        .filter(call => Boolean(call.leadSummary?.serviceType && call.leadSummary?.callback))
        .sort((a,b) => Number(a.startedAt || 0) - Number(b.startedAt || 0))[0]?.startedAt || null,
    };
  }

  async stats(tenantId) {
    await this.load();
    const calls = Object.values(this.data.calls).filter(call => call.tenantId === tenantId);
    return {
      callsHandled: calls.length,
      humanTransfers: calls.filter(call => call.transferred).length,
      spamScreened: calls.filter(call => call.spamEnded).length,
      callsWithTranscript: calls.filter(call => (call.transcript || []).length > 0).length,
      knowledgeGaps: calls.reduce((sum, call) => sum + (call.knowledgeGaps || []).length, 0),
    };
  }

  async get(tenantId, callId) {
    await this.load();
    const call = this.data.calls[callId];
    return call?.tenantId === tenantId ? structuredClone(call) : null;
  }
}
