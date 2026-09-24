import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

// One Render instance owns this disk. Move to a transactional database before scaling.
export class BillingStore {
  constructor(file) { this.file = file; this.queue = Promise.resolve(); this.data = { version: 1, mode: 'test', accounts: {}, events: {} }; }
  async load() {
    try { this.data = JSON.parse(await readFile(this.file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (this.data.version !== 1 || this.data.mode !== 'test' || !this.data.accounts || !this.data.events) throw new Error('invalid_billing_store');
    return this;
  }
  transaction(fn) {
    const operation = this.queue.then(async () => {
      const draft = structuredClone(this.data);
      const result = await fn(draft);
      await mkdir(path.dirname(this.file), { recursive: true });
      await writeFile(`${this.file}.tmp`, JSON.stringify(draft), { mode: 0o600 });
      await rename(`${this.file}.tmp`, this.file);
      this.data = draft;
      return structuredClone(result);
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}
