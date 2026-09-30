import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import { parseDialedNumber } from '../src/operator.js';

const root = new URL('../twilio/private-voice-lab/functions/', import.meta.url);
const now = Date.now();
const admitted = new Map();
const items = key => ({ fetch: async () => {
  if (!admitted.has(key)) throw new Error('missing');
  return { data: admitted.get(key) };
} });
items.create = async ({ key, data }) => {
  if (admitted.has(key)) throw new Error('duplicate');
  admitted.set(key, data);
};
const base = {
  ACCOUNT_SID: 'AC' + 'a'.repeat(32), PRIVATE_NUMBER: '+14155550110',
  TEST_CALLER_NUMBER: '+14155550111', HUMAN_FALLBACK_NUMBER: '+14155550112',
  PRIVATE_PROJECT_ID: 'proj_' + 'x'.repeat(24),
  SYNC_SERVICE_SID: 'IS' + 'c'.repeat(32), SYNC_MAP_SID: 'MP' + 'd'.repeat(32),
  TEST_RUN_ID: 'lab-one-attempt-20260930',
  DOMAIN_NAME: 'bookedradar-private-test.twil.io', LAB_TEST_ARMED: 'true',
  TEST_WINDOW_START: new Date(now - 60_000).toISOString(),
  TEST_WINDOW_END: new Date(now + 5 * 60_000).toISOString(),
  getTwilioClient: () => ({ sync: { v1: { services: () => ({ syncMaps: () => ({
    syncMapItems: items,
  }) }) } } }),
};
const call = { AccountSid: base.ACCOUNT_SID, To: base.PRIVATE_NUMBER,
  From: base.TEST_CALLER_NUMBER, CallSid: 'CA' + 'b'.repeat(32) };

class VoiceResponse {
  constructor() { this.commands = []; }
  reject(options) { this.commands.push(['reject', options]); }
  hangup() { this.commands.push(['hangup']); }
  dial(options) {
    const command = ['dial', options, []]; this.commands.push(command);
    return { sip: uri => command[2].push(['sip', uri]),
      number: number => command[2].push(['number', number]) };
  }
}

function load(name) {
  const exports = {};
  vm.runInNewContext(readFileSync(fileURLToPath(new URL(name, root)), 'utf8'),
    { exports, Twilio: { twiml: { VoiceResponse } }, Date, Set }, { filename: name });
  return exports;
}
async function invoke(fn, context, event) {
  let result;
  await fn.handler(context, event, (error, response) => {
    assert.equal(error, null); result = response.commands;
  });
  assert.ok(result); return result;
}

test('unarmed, expired, mismatched and looping calls never reach SIP', async () => {
  const fn = load('private-inbound.protected.js');
  const cases = [
    [{ ...base, LAB_TEST_ARMED: 'false' }, call],
    [{ ...base, TEST_WINDOW_END: new Date(now - 1).toISOString() }, call],
    [{ ...base, TEST_WINDOW_END: new Date(now + 60_000).toISOString() }, call],
    [base, { ...call, From: base.HUMAN_FALLBACK_NUMBER }],
    [base, { ...call, To: '+14092321112' }],
    [base, { ...call, AccountSid: 'AC' + '0'.repeat(32) }],
    [{ ...base, TEST_CALLER_NUMBER: base.HUMAN_FALLBACK_NUMBER }, call],
    [{ ...base, PRIVATE_PROJECT_ID: 'sip:attacker@example.com' }, call],
    [{ ...base, SYNC_SERVICE_SID: '' }, call],
  ];
  for (const [context, event] of cases) assert.equal((await invoke(fn, context, event))[0][0], 'reject');
});

test('approved short window makes one bounded private SIP leg', async () => {
  const commands = await invoke(load('private-inbound.protected.js'), base, call);
  assert.equal(commands.length, 1);
  assert.equal(commands[0][0], 'dial');
  assert.equal(commands[0][1].timeout, 15);
  assert.equal(commands[0][1].timeLimit, 60);
  assert.match(commands[0][1].action, /^https:\/\/bookedradar-private-test\.twil\.io\/private-outcome$/);
  const uri = commands[0][2][0][1];
  assert.equal(uri.split('?')[0], `sip:${base.PRIVATE_PROJECT_ID}@sip.api.openai.com;transport=tls`);
  const calledParty = new URLSearchParams(uri.split('?')[1]).get('P-Called-Party-ID');
  assert.equal(parseDialedNumber([
    { name: 'To', value: `<sip:${base.PRIVATE_PROJECT_ID}@sip.api.openai.com>` },
    { name: 'P-Called-Party-ID', value: calledParty },
  ]), base.PRIVATE_NUMBER);
});

test('called-party routing preserves existing precedence and rejects malformed identity', () => {
  const identity = { name: 'P-Called-Party-ID', value: `<tel:${base.PRIVATE_NUMBER}>` };
  assert.equal(parseDialedNumber([{ name: 'To', value: '<sip:+14155550199@example.com>' }, identity]), '+14155550199');
  assert.equal(parseDialedNumber([{ name: 'Diversion', value: '<tel:+14155550198>' }, identity]), '+14155550198');
  assert.equal(parseDialedNumber([{ name: 'p-called-party-id', value: '<tel:invalid>' }]), '');
  assert.equal(parseDialedNumber([{ name: 'X-Untrusted-Number', value: '<tel:+14155550110>' }]), '');
});

test('only authenticated failed SIP outcomes get one bounded human leg', async () => {
  const fn = load('private-outcome.protected.js');
  for (const [status, code] of [['busy', '486'], ['failed', '503'], ['no-answer', undefined]]) {
    const context = { ...base, TEST_RUN_ID: `lab-fallback-${status}-20260930` };
    admitted.set(context.TEST_RUN_ID, { callSid: call.CallSid });
    const commands = await invoke(fn, context, { ...call, DialCallStatus: status, DialSipResponseCode: code });
    assert.deepEqual(commands.map(x => x[0]), ['dial', 'hangup']);
    assert.equal(commands[0][1].timeLimit, 60);
    assert.equal(commands[0][1].callerId, base.PRIVATE_NUMBER);
    assert.equal(commands[0][2][0][1], base.HUMAN_FALLBACK_NUMBER);
  }
  for (const status of ['completed', 'canceled', 'answered', 'unexpected']) {
    assert.equal((await invoke(fn, base, { ...call, DialCallStatus: status, DialSipResponseCode: '200' }))[0][0], 'hangup');
  }
  assert.equal((await invoke(fn, base, { ...call, From: base.HUMAN_FALLBACK_NUMBER,
    DialCallStatus: 'failed', DialSipResponseCode: '503' }))[0][0], 'hangup');
});

test('primary webhook failure route rejects without starting a provider leg', async () => {
  const commands = await invoke(load('private-unavailable.protected.js'), base, call);
  assert.deepEqual(commands.map(x => x[0]), ['reject']);
  assert.equal(commands[0][1].reason, 'busy');
});

test('duplicate and unavailable atomic admission never start a second SIP leg', async () => {
  const fn = load('private-inbound.protected.js');
  assert.equal((await invoke(fn, base, call))[0][0], 'reject');
  const failing = { ...base, TEST_RUN_ID: 'lab-sync-outage-20260930',
    getTwilioClient: () => { throw new Error('unavailable'); } };
  assert.equal((await invoke(fn, failing, call))[0][0], 'reject');
});

test('concurrent requests for one run admit exactly one SIP leg', async () => {
  const fn = load('private-inbound.protected.js');
  const context = { ...base, TEST_RUN_ID: 'lab-concurrent-admission-20260930' };
  const results = await Promise.all([
    invoke(fn, context, call),
    invoke(fn, context, { ...call, CallSid: 'CA' + 'e'.repeat(32) }),
  ]);
  assert.deepEqual(results.map(x => x[0][0]).sort(), ['dial', 'reject']);
});

test('callback retry, mismatched call and Sync outage cannot redial human', async () => {
  const fn = load('private-outcome.protected.js');
  const context = { ...base, TEST_RUN_ID: 'lab-callback-retry-20260930' };
  admitted.set(context.TEST_RUN_ID, { callSid: call.CallSid });
  const event = { ...call, DialCallStatus: 'failed', DialSipResponseCode: '503' };
  assert.equal((await invoke(fn, context, event))[0][0], 'dial');
  assert.equal((await invoke(fn, context, event))[0][0], 'hangup');
  const other = { ...base, TEST_RUN_ID: 'lab-call-mismatch-20260930' };
  admitted.set(other.TEST_RUN_ID, { callSid: 'CA' + 'f'.repeat(32) });
  assert.equal((await invoke(fn, other, event))[0][0], 'hangup');
  const outage = { ...base, TEST_RUN_ID: 'lab-callback-outage-20260930',
    getTwilioClient: () => { throw new Error('unavailable'); } };
  assert.equal((await invoke(fn, outage, event))[0][0], 'hangup');
});
