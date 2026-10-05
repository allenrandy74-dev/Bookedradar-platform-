// Synthetic fixture only. Invoked by the bounded outer-shell harness, with
// deny-network preloaded. It does not spawn children or contact providers.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { JsonStateStore } from '../../src/state-store.js';
import { RecoveryStore } from '../../src/recovery/store.js';
import { CallHistoryStore } from '../../src/call-history.js';
const [mode, dir, worker = '0'] = process.argv.slice(2);
if (!dir?.startsWith('/tmp/br-multiprocess-')) throw new Error('synthetic_directory_required');
const state = new JsonStateStore(path.join(dir, 'state.json'));
const recovery = new RecoveryStore(path.join(dir, 'recovery.json'));
const history = new CallHistoryStore(path.join(dir, 'history.json'));
if (mode === 'writer') {
  await Promise.all([state.load(), recovery.load(), history.load()]);
  await fs.writeFile(path.join(dir, `ready-${worker}`), 'ready');
  while (true) { try { await fs.access(path.join(dir, 'go')); break; } catch { await new Promise(r => setTimeout(r, 10)); } }
  const claim = await state.markWebhookOnce('shared-event');
  await fs.writeFile(path.join(dir, `claim-${worker}`), String(claim));
  for (let i = 0; i < 15; i++) {
    await state.patchCall(`call-${worker}-${i}`, { tenantId: 'synthetic' });
    await history.start(`history-${worker}-${i}`, { tenantId: 'synthetic' });
    await recovery.createOpportunity({ id: `opportunity-${worker}-${i}`, tenantId: 'synthetic' });
    await recovery.addEvent({ tenantId: 'synthetic', idempotencyKey: 'shared-recovery', type: 'fixture' });
  }
} else if (mode === 'verify') {
  await state.load();
  assert.equal(Object.keys(state.state.calls).length, 60);
  assert.equal((await history.list('synthetic', { limit: 100 })).length, 60);
  const snap = await recovery.snapshot();
  assert.equal(Object.keys(snap.opportunities).length, 60);
  assert.equal(snap.events.length, 1);
  const claims = await Promise.all([0,1,2,3].map(i => fs.readFile(path.join(dir, `claim-${i}`), 'utf8')));
  assert.equal(claims.filter(x => x === 'true').length, 1);
  console.log('PASS: four independent synchronized processes retain all 180 records; one webhook winner and one recovery event');
} else if (mode === 'crash') {
  await recovery.transaction(async tx => {
    await tx.addEvent({ tenantId: 'synthetic', idempotencyKey: 'crash-receipt', type: 'fixture' });
    await tx.createOpportunity({ id: 'crash-opportunity', tenantId: 'synthetic' });
    await fs.writeFile(path.join(dir, 'crash-ready'), 'ready');
    await new Promise(resolve => setTimeout(resolve, 60000));
  });
} else if (mode === 'verify-crash') {
  await assert.rejects(recovery.snapshot(), /json_store_locked/);
  const snapshot = JSON.parse(await fs.readFile(path.join(dir, 'recovery.json'), 'utf8'));
  assert.equal(snapshot.events.some(e => e.idempotencyKey === 'crash-receipt'), false);
  assert.equal(snapshot.opportunities['crash-opportunity'], undefined);
  await fs.access(path.join(dir, 'recovery.json.lock'));
  console.log('PASS: SIGKILL before commit stores neither receipt nor opportunity; abandoned lock refuses automatic takeover');
} else throw new Error('unsupported_mode');
