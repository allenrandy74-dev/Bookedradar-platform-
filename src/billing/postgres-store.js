import fs from 'node:fs/promises';
import path from 'node:path';

function validate(data, mode) {
  const record = value => value && typeof value === 'object' && !Array.isArray(value);
  if (data?.version !== 1 || data.mode !== mode || !record(data.accounts) || !record(data.events)) {
    throw new Error('invalid_billing_store');
  }
}

// Not wired into production. The single row per mode preserves the current
// global founding-partner quota and transaction callback contract across workers.
export class PostgresBillingStore {
  constructor(pool, { mode = 'test' } = {}) {
    if (!['test', 'live'].includes(mode)) throw new Error('invalid_billing_mode');
    this.pool = pool;
    this.mode = mode;
  }

  async load() {
    const { rows } = await this.pool.query('SELECT payload FROM bookedradar.billing_state WHERE mode=$1', [this.mode]);
    if (rows.length) validate(rows[0].payload, this.mode);
    return this;
  }

  async transaction(fn) {
    if (typeof fn !== 'function') throw new Error('billing_transaction_required');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='5s'");
      await client.query("SET LOCAL statement_timeout='15s'");
      const initial = { version: 1, mode: this.mode, accounts: {}, events: {} };
      await client.query(`INSERT INTO bookedradar.billing_state (mode,payload)
        VALUES ($1,$2::jsonb) ON CONFLICT (mode) DO NOTHING`, [this.mode, JSON.stringify(initial)]);
      const { rows } = await client.query(
        'SELECT payload FROM bookedradar.billing_state WHERE mode=$1 FOR UPDATE', [this.mode]
      );
      const draft = rows[0].payload;
      validate(draft, this.mode);
      // Never retry this callback automatically: it can invoke an external provider.
      const result = structuredClone(await fn(draft));
      validate(draft, this.mode);
      const serialized = JSON.stringify(draft);
      validate(JSON.parse(serialized), this.mode);
      await client.query('UPDATE bookedradar.billing_state SET payload=$2::jsonb, updated_at=clock_timestamp() WHERE mode=$1', [this.mode, serialized]);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally { client.release(); }
  }
}

// Component export only. A database rollback cannot undo an external Stripe operation.
export async function exportPostgresBillingState(pool, destinationRoot, { mode = 'test', writersQuiesced = false } = {}) {
  if (!writersQuiesced) throw new Error('writers_must_be_quiesced');
  if (!['test', 'live'].includes(mode)) throw new Error('invalid_billing_mode');
  if (typeof destinationRoot !== 'string' || !destinationRoot.trim()) throw new Error('destination_root_required');
  const { rows } = await pool.query('SELECT payload FROM bookedradar.billing_state WHERE mode=$1', [mode]);
  if (!rows.length) throw new Error('billing_state_missing');
  validate(rows[0].payload, mode);
  await fs.mkdir(destinationRoot, { recursive: true, mode: 0o700 });
  const directory = await fs.mkdtemp(path.join(destinationRoot, 'billing-export-'));
  await fs.chmod(directory, 0o700);
  const file = path.join(directory, `billing-${mode}-state.json`);
  await fs.writeFile(file, JSON.stringify(rows[0].payload) + '\n', { flag: 'wx', mode: 0o600 });
  return { file, mode, accounts: Object.keys(rows[0].payload.accounts).length, events: Object.keys(rows[0].payload.events).length };
}
