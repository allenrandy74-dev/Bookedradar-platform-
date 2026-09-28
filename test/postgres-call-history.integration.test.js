import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { PostgresCallHistoryStore, exportPostgresCallHistory } from '../src/postgres-call-history.js';
import { CallHistoryStore } from '../src/call-history.js';

const connectionString = process.env.POSTGRES_TEST_URL;
test('real Postgres: history concurrency, transcript consistency, privacy and recovery', { skip: !connectionString }, async t => {
  const url = new URL(connectionString);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.equal(url.pathname, '/bookedradar_test');
  const pool = new Pool({ connectionString, max: 10 });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'br-pg-history-'));
  try {
    await pool.query('DROP SCHEMA IF EXISTS bookedradar CASCADE');
    await pool.query(await fs.readFile(new URL('../db/postgres-schema.sql', import.meta.url), 'utf8'));
    const a = new PostgresCallHistoryStore(pool, 'tenant-a');
    const b = new PostgresCallHistoryStore(pool, 'tenant-b');
    await t.test('concurrent starts preserve one call and reject reassignment', async () => {
      await Promise.all(Array.from({ length: 10 }, () => a.start('call-a', { callerMasked: '***0101' })));
      const call = await a.get('call-a');
      assert.equal(call.telemetryVersion, 1);
      assert.equal(call.tenantId, 'tenant-a');
      await assert.rejects(b.start('call-a'), /call_tenant_conflict/);
      assert.equal(await b.get('call-a'), null);
      assert.equal(await b.addTurn('call-a', { text: 'forbidden' }), null);
    });
    await t.test('concurrent turns are not lost and normalized rows exactly match their committed order', async () => {
      await Promise.all(Array.from({ length: 30 }, (_, i) => a.addTurn('call-a', { speaker: 'caller', text: `turn ${i}`, itemId: `item-${i}` })));
      const call = await a.get('call-a');
      assert.equal(call.transcript.length, 30);
      assert.equal(new Set(call.transcript.map(turn => turn.itemId)).size, 30);
      const { rows } = await pool.query('SELECT sequence_no,text_content FROM bookedradar.call_turns WHERE call_id=$1 ORDER BY sequence_no', ['call-a']);
      assert.deepEqual(rows.map(row => row.sequence_no), Array.from({ length: 30 }, (_, i) => i));
      assert.deepEqual(rows.map(row => row.text_content), call.transcript.map(turn => turn.text));
    });
    await t.test('milestone counts and unique knowledge gaps survive simultaneous writers', async () => {
      await Promise.all(Array.from({ length: 20 }, () => a.mark('call-a', 'greeting.first_audio', { latencyMs: 2000 })));
      await Promise.all(Array.from({ length: 10 }, () => a.addKnowledgeGap('call-a', { question: 'Do you service heat pumps?' })));
      const call = await a.get('call-a');
      assert.equal(call.milestones['greeting.first_audio'].count, 20);
      assert.equal(call.knowledgeGaps.length, 1);
    });
    await t.test('sensitive text is redacted in payload and normalized turns', async () => {
      await a.addTurn('call-a', { text: 'SSN 123-45-6789 and card 4111 1111 1111 1111' });
      const text = (await a.get('call-a')).transcript.at(-1).text;
      assert.match(text, /REDACTED_SSN/);
      assert.match(text, /REDACTED_PAYMENT_NUMBER/);
      const { rows } = await pool.query('SELECT text_content FROM bookedradar.call_turns WHERE call_id=$1 ORDER BY sequence_no DESC LIMIT 1', ['call-a']);
      assert.equal(rows[0].text_content, text);
    });
    await t.test('normalized write failure rolls back payload and all transcript rows', async () => {
      const before = await a.get('call-a');
      await pool.query("ALTER TABLE bookedradar.call_turns ADD CONSTRAINT synthetic_reject CHECK (text_content <> 'reject-me')");
      await assert.rejects(a.addTurn('call-a', { text: 'reject-me' }));
      assert.deepEqual(await a.get('call-a'), before);
      const { rows } = await pool.query('SELECT text_content FROM bookedradar.call_turns WHERE call_id=$1 ORDER BY sequence_no', ['call-a']);
      assert.deepEqual(rows.map(row => row.text_content), before.transcript.map(turn => turn.text));
      await pool.query('ALTER TABLE bookedradar.call_turns DROP CONSTRAINT synthetic_reject');
    });
    await t.test('200-turn bound stays consistent in both representations', async () => {
      await a.start('bounded');
      const seed = await a.get('bounded');
      seed.transcript = Array.from({ length: 199 }, (_, i) => ({ speaker: 'caller', text: `seed ${i}`, itemId: `s${i}`, at: new Date().toISOString() }));
      await pool.query('UPDATE bookedradar.voice_calls SET payload=$2::jsonb WHERE call_id=$1', ['bounded', JSON.stringify(seed)]);
      await Promise.all(Array.from({ length: 3 }, (_, i) => a.addTurn('bounded', { text: `new ${i}` })));
      const transcript = (await a.get('bounded')).transcript;
      assert.equal(transcript.length, 200);
      assert.equal(transcript[0].text, 'seed 2');
      const { rows } = await pool.query('SELECT text_content FROM bookedradar.call_turns WHERE call_id=$1 ORDER BY sequence_no', ['bounded']);
      assert.deepEqual(rows.map(row => row.text_content), transcript.map(turn => turn.text));
    });
    await t.test('finish and reporting preserve JSON behavior and tenant boundaries', async () => {
      await a.finish('call-a', { transferred: true, leadSummary: { serviceType: 'repair', callback: 'synthetic' } });
      await b.start('call-b');
      assert.equal((await a.stats()).callsHandled, 2);
      assert.equal((await b.stats()).callsHandled, 1);
      assert.equal((await a.list({ q: 'turn 1' })).length, 1);
      const report = await exportPostgresCallHistory(pool, root, { writersQuiesced: true });
      const json = new CallHistoryStore(report.file);
      assert.deepEqual(await json.get('tenant-a', 'call-a'), await a.get('call-a'));
      assert.deepEqual(await json.stats('tenant-a'), await a.stats());
      const now = Date.now();
      assert.deepEqual(await json.operationalSummary({ tenantId: 'tenant-a', now }), await a.operationalSummary({ now }));
      assert.equal(report.calls, 3);
      assert.equal((await fs.stat(report.file)).mode & 0o777, 0o600);
    });
  } finally {
    await pool.query('DROP SCHEMA IF EXISTS bookedradar CASCADE');
    await pool.end();
    await fs.rm(root, { recursive: true, force: true });
  }
});
