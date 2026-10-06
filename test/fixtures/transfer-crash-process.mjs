// Run as two guarded, independent Node processes: crash then replay.
import assert from 'node:assert/strict';
import { appendFile, readFile } from 'node:fs/promises';
import { JsonStateStore } from '../../src/state-store.js';
import { createTransferController } from '../../src/warm-transfer.js';
import { createTransferCompanion } from '../../src/transfer-companion.js';
const [mode, directory] = process.argv.slice(2);
const store = new JsonStateStore(directory + '/state.json'); await store.load();
const input = { callId: 'crash-call', tenant: { tenantId: 'synthetic' }, target: '+15555550101', prepare: async () => ({}) };
const effect = async () => { await appendFile(directory + '/effects', mode + '\n'); process.exit(0); };
if (mode === 'refer-crash' || mode === 'refer-replay') {
 const run = createTransferController({ store, log() {}, relay: { preflight: () => ({ ready: false }) }, refer: mode === 'refer-crash' ? effect : async () => assert.fail('replayed REFER') });
 const result = await run(input);
 assert.equal(result.reason, 'transfer_attempt_pending');
} else {
 const companion = createTransferCompanion({ store, config: { accountSid: 'AC'+'a'.repeat(32),authToken:'synthetic',fromNumber:'+15555550100' }, log() {}, fetchImpl: mode === 'sms-crash' ? effect : async () => assert.fail('replayed SMS') });
 const result = await companion.notifyAndWait(input);
 assert.equal(result.duplicate, true);
}
console.log(mode + ': persisted pending fence prevented replay; effects=' + (await readFile(directory + '/effects','utf8')).trim().split('\n').length);
