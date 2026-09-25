import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createBackup, restoreBackup, backupSources } from '../scripts/backup.js';

test('encrypted state backup restores all stores without overwriting and rejects wrong keys', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'br-backup-'));
  try {
    const sources = {};
    for (const name of ['state.json', 'recovery-state.json', 'leads.jsonl', 'voice-transfers.json', 'billing-test-state.json', 'billing-live-state.json', 'call-history.json', 'web-chat.json']) {
      sources[name] = path.join(root, name);
      await fs.writeFile(sources[name], JSON.stringify({ synthetic: true, marker: name }));
    }
    const key = 'ab'.repeat(32);
    const archive = path.join(root, 'snapshot.brbackup');
    const result = await createBackup({ sources, destination: archive, key, quiesced: true });
    assert.equal(result.complete, true);
    assert.equal((await fs.readFile(archive, 'utf8')).includes('synthetic'), false);
    const destination = path.join(root, 'restore');
    await assert.rejects(restoreBackup({ archive, destination, key: 'cd'.repeat(32) }));
    await assert.rejects(fs.access(destination));
    await restoreBackup({ archive, destination, key });
    for (const name of Object.keys(sources)) assert.deepEqual(await fs.readFile(path.join(destination, name)), await fs.readFile(sources[name]));
    await assert.rejects(restoreBackup({ archive, destination, key }));
    await assert.rejects(createBackup({ sources, destination: archive, key, quiesced: true }));
    await assert.rejects(createBackup({ sources, destination: archive, key, quiesced: false }));
    for (const file of Object.values(sources)) await fs.unlink(file);
    await assert.rejects(createBackup({ sources, destination: path.join(root, 'empty'), key, quiesced: true }), /No state files/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('backup keeps test and live billing distinct and includes conversation stores', () => {
  const sources = backupSources({STATE_FILE:'/app/data/state.json', BOOKEDRADAR_BILLING_MODE:'live', BILLING_STATE_FILE:'/app/data/custom-live.json', CALL_HISTORY_FILE:'/app/data/history.json', WEB_CHAT_STATE_FILE:'/app/data/chat.json'});
  assert.equal(sources['billing-live-state.json'], '/app/data/custom-live.json');
  assert.equal(sources['billing-test-state.json'], '/app/data/billing-test-state.json');
  assert.equal(sources['call-history.json'], '/app/data/history.json');
  assert.equal(sources['web-chat.json'], '/app/data/chat.json');
  assert.equal(backupSources({BILLING_STATE_FILE:'/test.json'})['billing-test-state.json'], '/test.json');
  assert.throws(() => backupSources({BOOKEDRADAR_BILLING_MODE:'typo'}), /Invalid billing mode/);
});
