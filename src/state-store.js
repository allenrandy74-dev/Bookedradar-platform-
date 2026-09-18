import fs from "node:fs/promises";
import path from "node:path";

export class JsonStateStore {
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
    this.state = { processedWebhooks: {}, calls: {} };
    this.loaded = false;
    this.writeChain = Promise.resolve();
  }
  async load() {
    if (this.loaded) return;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      this.state.processedWebhooks = parsed.processedWebhooks || {};
      this.state.calls = parsed.calls || {};
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    this.loaded = true;
    await this.prune();
  }
  async persist() {
    const temp = `${this.filePath}.tmp`;
    const body = JSON.stringify(this.state, null, 2);
    this.writeChain = this.writeChain.then(async () => {
      await fs.writeFile(temp, body, "utf8");
      await fs.rename(temp, this.filePath);
    });
    return this.writeChain;
  }
  async prune(now = Date.now()) {
    const webhookCutoff = now - 24 * 60 * 60 * 1000;
    const callCutoff = now - 30 * 24 * 60 * 60 * 1000;
    for (const [id, ts] of Object.entries(this.state.processedWebhooks)) if (Number(ts) < webhookCutoff) delete this.state.processedWebhooks[id];
    for (const [id, value] of Object.entries(this.state.calls)) if (Number(value?.updatedAt || 0) < callCutoff) delete this.state.calls[id];
  }
  async markWebhookOnce(id) {
    await this.load();
    if (!id) return true;
    if (this.state.processedWebhooks[id]) return false;
    this.state.processedWebhooks[id] = Date.now();
    await this.persist();
    return true;
  }
  async getCall(callId) { await this.load(); return this.state.calls[callId] || null; }
  async patchCall(callId, patch) {
    await this.load();
    this.state.calls[callId] = { ...(this.state.calls[callId] || {}), ...patch, updatedAt: Date.now() };
    await this.persist();
    return this.state.calls[callId];
  }
}
