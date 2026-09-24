import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

function clean(value, max = 2000) {
  return String(value ?? "").trim().slice(0, max);
}

const LEAD_FIELDS = ["name","phone","email","service_type","service_address","city","urgency","preferred_window"];

export class WebChatStore {
  constructor(filePath, { retentionDays = 30 } = {}) {
    this.filePath = path.resolve(filePath);
    this.retentionDays = Number(retentionDays) || 30;
    this.data = { sessions: {} };
    this.loaded = false;
    this.writeChain = Promise.resolve();
  }
  async load() {
    if (this.loaded) return;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      this.data = { sessions: parsed.sessions || {} };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    this.loaded = true;
    await this.prune();
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
  async prune(now = Date.now()) {
    if (!this.loaded) return;
    const cutoff = now - this.retentionDays * 86400000;
    let changed = false;
    for (const [id, session] of Object.entries(this.data.sessions)) {
      if (Number(session.updatedAt || session.createdAt || 0) < cutoff) {
        delete this.data.sessions[id]; changed = true;
      }
    }
    if (changed) await this.persist();
  }
  async getOrCreate(tenantId, sessionId = "") {
    await this.load();
    let session = sessionId ? this.data.sessions[sessionId] : null;
    if (session && session.tenantId !== tenantId) session = null;
    if (!session) {
      const id = crypto.randomUUID();
      session = { id, tenantId, createdAt: Date.now(), updatedAt: Date.now(), messages: [], fields: {}, opportunityId: null };
      this.data.sessions[id] = session;
      await this.persist();
    }
    return structuredClone(session);
  }
  async update(sessionId, patch) {
    await this.load();
    const current = this.data.sessions[sessionId];
    if (!current) throw new Error("unknown_chat_session");
    const next = { ...current, ...patch, updatedAt: Date.now() };
    if (patch.messages) next.messages = patch.messages.slice(-24);
    this.data.sessions[sessionId] = next;
    await this.persist();
    return structuredClone(next);
  }
}

export function webChatEnabled(tenant = {}) {
  return tenant?.features?.webChat === true && tenant?.integrations?.webChat?.enabled === true;
}

export function allowedWebChatOrigin(tenant, origin = "") {
  const allowed = Array.isArray(tenant?.integrations?.webChat?.allowedOrigins)
    ? tenant.integrations.webChat.allowedOrigins.map(x => String(x).replace(/\/$/,""))
    : [];
  if (!allowed.length) return false;
  return allowed.includes(String(origin || "").replace(/\/$/,""));
}

export function webChatInstructions(tenant = {}) {
  const services = Array.isArray(tenant.services) ? tenant.services.filter(Boolean).join(", ") : "";
  return [
    `You are BookedRadar's web assistant for ${clean(tenant.businessName,120) || "the business"}.`,
    "Help a prospective or existing customer with a short, professional conversation.",
    "Ask at most one missing intake question per reply. Use details already supplied and never make the visitor repeat them.",
    "Useful lead fields are name, callback phone or email, actual service address, city, service need, urgency, and preferred timing.",
    "Never invent pricing, live availability, warranties, promotions, service coverage, response times, or diagnoses.",
    tenant?.policies?.bookingMode === "live_booking"
      ? "Only say an appointment is confirmed if the supplied context explicitly includes a confirmed booking."
      : "Live booking is not enabled. Collect preferred timing and say the team will confirm it.",
    tenant?.policies?.quotePrices ? "Only repeat pricing explicitly present in supplied context." : "Do not quote or estimate prices.",
    services ? `Approved services include: ${services}.` : "",
    clean(tenant?.escalation?.safetyRule,500)
      ? `Safety rule: ${clean(tenant.escalation.safetyRule,500)}`
      : "For immediate danger, tell the visitor to move to safety and contact emergency services or the appropriate utility.",
    "If the visitor asks for a human, has a complaint/payment dispute, or asks something you cannot answer from supplied facts, say the team will follow up rather than guessing.",
    "Never request Social Security numbers, passwords, or full payment-card numbers.",
    "Reply naturally in English or Spanish based on the visitor's language.",
    "Return only the required JSON object.",
  ].filter(Boolean).join("\n");
}

const CHAT_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    fields: {
      type: "object",
      properties: Object.fromEntries(LEAD_FIELDS.map(key => [key,{type:"string"}])),
      required: LEAD_FIELDS,
      additionalProperties: false,
    },
    needs_human: { type: "boolean" },
    lead_ready: { type: "boolean" },
  },
  required: ["reply","fields","needs_human","lead_ready"],
  additionalProperties: false,
};

export async function runWebChatTurn({ client, model = "gpt-5.6-luna", tenant, session, message }) {
  if (!client?.responses?.create) throw new Error("web_chat_ai_client_unavailable");
  const known = Object.fromEntries(LEAD_FIELDS.map(key => [key, clean(session?.fields?.[key], 300)]));
  const recent = (session?.messages || []).slice(-10).map(item => `${item.role}: ${clean(item.text,800)}`).join("\n");
  const input = [
    `Known fields: ${JSON.stringify(known)}`,
    recent ? `Recent conversation:\n${recent}` : "",
    `Visitor: ${clean(message,1600)}`,
  ].filter(Boolean).join("\n\n");
  const response = await client.responses.create({
    model,
    reasoning: { effort: "none" },
    instructions: webChatInstructions(tenant),
    input,
    text: {
      format: {
        type: "json_schema",
        name: "bookedradar_web_chat_turn",
        strict: true,
        schema: CHAT_SCHEMA,
      },
    },
    max_output_tokens: 500,
  });
  const parsed = JSON.parse(response.output_text);
  const fields = {};
  for (const key of LEAD_FIELDS) fields[key] = clean(parsed?.fields?.[key], 300) || known[key];
  return {
    reply: clean(parsed.reply, 1000),
    fields,
    needsHuman: parsed.needs_human === true,
    leadReady: parsed.lead_ready === true,
  };
}
