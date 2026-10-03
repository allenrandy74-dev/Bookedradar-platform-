import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { customerResultSnapshot, syntheticMarker } from '../src/customer-results-scope.js';
import { RecoveryStore } from '../src/recovery/store.js';
import { RecoveryEngine } from '../src/recovery/engine.js';
import { radarProof } from '../src/recovery/radarproof.js';
import { ownerDailyBrief } from '../src/growth-intelligence.js';
import { CallHistoryStore } from '../src/call-history.js';
import { PostgresCallHistoryStore } from '../src/postgres-call-history.js';

const now = new Date('2026-10-02T12:00:00Z');
const at = '2026-10-02T10:00:00Z';
const opportunity = (id, fields = {}) => ({ id, tenantId: 't1', createdAt: at, updatedAt: at, ...fields });
const snapshot = (fields = {}) => ({ opportunities: {}, attribution: {}, actions: {}, events: [], ...fields });
const store = data => ({ snapshot: async () => structuredClone(data) });

test('Only explicit boolean synthetic markers classify records; true wins a conflict', () => {
  for (const x of [{ synthetic: true }, { metadata: { synthetic: true } }, { synthetic: false, metadata: { synthetic: true } }]) assert.equal(syntheticMarker(x), true);
  for (const x of [{ synthetic: false }, { metadata: { synthetic: false } }]) assert.equal(syntheticMarker(x), false);
  for (const x of [{}, { synthetic: 'true' }, { synthetic: 1 }, { synthetic: null }, { name: 'Synthetic Test', source: 'simulation' }]) assert.equal(syntheticMarker(x), null);
});

test('A marked source event excludes its opportunity and related attribution, actions and events without mutation', async () => {
  const data = snapshot({
    opportunities: { a: opportunity('a', { sourceEventId: 'seed', recovered: true, recoveredAt: at }) },
    attribution: { a: { tenantId: 't1', opportunityId: 'a', recovered: true, confirmedRevenue: 999, confirmedAt: at } },
    actions: { a: { id: 'a', tenantId: 't1', opportunityId: 'a', status: 'pending' } },
    events: [{ id: 'seed', tenantId: 't1', synthetic: true }, { id: 'latency', tenantId: 't1', opportunityId: 'a', responseLatencySeconds: 2 }],
  });
  const original = structuredClone(data);
  const result = await radarProof(store(data), 't1');
  assert.deepEqual([result.opportunitiesCaptured, result.recoveredOpportunities, result.confirmedRevenue, result.pendingActions, result.medianResponseSeconds], [0, 0, 0, 0, null]);
  assert.ok(result.dataCoverage.excludedRecords >= 5);
  assert.deepEqual(data, original);
  const brief = await ownerDailyBrief(store(data), 't1', { now });
  assert.equal(brief.newOpportunities, 0);
  assert.equal(brief.recoveredOpportunities, 0);
});

test('A foreign-tenant source-event identifier cannot mark a local opportunity synthetic', async () => {
  const data = snapshot({ opportunities: { a: opportunity('a', { sourceEventId: 'same-id' }) }, events: [{ id: 'same-id', tenantId: 't2', synthetic: true }] });
  assert.equal((await radarProof(store(data), 't1')).opportunitiesCaptured, 1);
});

test('An unlinked synthetic event without an ID cannot remove unrelated opportunities', async () => {
  const data = snapshot({ opportunities: { a: opportunity('a') }, events: [{ tenantId: 't1', synthetic: true, responseLatencySeconds: 2 }] });
  const result = await radarProof(store(data), 't1');
  assert.equal(result.opportunitiesCaptured, 1);
  assert.equal(result.medianResponseSeconds, null);
});

test('Unmarked history and synthetic-looking names are retained with an explicit coverage limitation', async () => {
  const result = await radarProof(store(snapshot({ opportunities: { a: opportunity('a', { source: 'simulation', name: 'Synthetic Test' }) } })), 't1');
  assert.equal(result.opportunitiesCaptured, 1);
  assert.equal(result.dataCoverage.historicalCompleteness, 'unverified');
  assert.equal(result.dataCoverage.unclassifiedRecords, 1);
  assert.match(result.dataCoverage.notice, /Unmarked history.*not been verified/);
});

test('Marked synthetic membership and review jobs do not enter Owner Brief summaries', async () => {
  const data = snapshot({ opportunities: {
    m: opportunity('m', { synthetic: true, status: 'open', type: 'membership_renewal_due' }),
    j: opportunity('j', { status: 'open', type: 'job_completed', metadata: { synthetic: true, customerSatisfactionKnown: true, customerSatisfied: true } }),
  } });
  const brief = await ownerDailyBrief(store(data), 't1', { now });
  assert.deepEqual([brief.membershipRenewalsDue, brief.reviewEligibleJobs, brief.reviewNeedsHumanCheck, brief.openRevenueLeaks], [0, 0, 0, 0]);
});

test('Recovered numerator counts unique captured IDs and excludes old and orphan outcomes', async () => {
  const data = snapshot({
    opportunities: { a: opportunity('a'), old: opportunity('old', { createdAt: '2026-09-01T00:00:00Z' }) },
    attribution: {
      a: { tenantId: 't1', opportunityId: 'a', recovered: true },
      duplicate: { tenantId: 't1', opportunityId: 'a', recovered: true },
      old: { tenantId: 't1', opportunityId: 'old', recovered: true, updatedAt: at },
      orphan: { tenantId: 't1', opportunityId: 'missing', recovered: true, updatedAt: at },
    },
  });
  const result = await radarProof(store(data), 't1', { sinceMs: Date.parse('2026-10-01T00:00:00Z'), untilMs: now.getTime() });
  assert.equal(result.opportunitiesCaptured, 1);
  assert.equal(result.recoveredOpportunities, 1);
  assert.equal(result.recoveryRate, 1);
  assert.equal(result.bySource.unknown.recovered, 1);
});

test('Latency rejects coercible nonnumbers and negatives while preserving genuine zero', async () => {
  const values = [null, '', ' ', false, true, '10', {}, -1, NaN, Infinity];
  let data = snapshot({ events: values.map(responseLatencySeconds => ({ tenantId: 't1', responseLatencySeconds })) });
  assert.equal((await radarProof(store(data), 't1')).medianResponseSeconds, null);
  data.events.push({ tenantId: 't1', responseLatencySeconds: 0 }, { tenantId: 't1', responseLatencySeconds: 10 });
  assert.equal((await radarProof(store(data), 't1')).medianResponseSeconds, 5);
});

test('Customer call reporting excludes marked records but operational/admission counters stay unchanged', async () => {
  const calls = new CallHistoryStore('/unused'); calls.loaded = true;
  calls.data.calls = {
    real: { tenantId: 't1', startedAt: now.getTime(), transferred: true },
    marked: { tenantId: 't1', startedAt: now.getTime(), synthetic: true, transferred: true },
  };
  const customer = await calls.stats('t1');
  assert.equal(customer.callsHandled, 1);
  assert.equal(customer.humanTransfers, 1);
  assert.equal(customer.humanTransfersMeaning, 'initiated_not_completed');
  assert.equal(customer.dataCoverage.historicalCompleteness, 'unverified');
  assert.equal((await calls.statsSince('t1')).callsHandled, 2);
  assert.equal((await calls.operationalSummary({ tenantId: 't1' })).callsStarted, 2);
});

test('PostgreSQL customer read projection reuses marker filtering without a write or schema change', async () => {
  const queries = [];
  const pool = { query: async (sql, args) => {
    queries.push(sql); assert.match(sql, /^SELECT call_id,payload/); assert.deepEqual(args, ['t1']);
    return { rows: [
      { call_id: 'real', payload: { tenantId: 't1', startedAt: now.getTime() } },
      { call_id: 'marked', payload: { tenantId: 't1', startedAt: now.getTime(), metadata: { synthetic: true } } },
    ] };
  } };
  const pg = new PostgresCallHistoryStore(pool, 't1');
  assert.equal((await pg.stats()).callsHandled, 1);
  assert.equal((await pg.statsSince()).callsHandled, 2);
  assert.equal(queries.length, 2);
});

test('An existing persisted call marker survives load and is applied only by customer stats', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'br-result-markers-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'calls.json');
  await fs.writeFile(file, JSON.stringify({ calls: { a: { tenantId: 't1', startedAt: Date.now(), synthetic: true } } }));
  const calls = new CallHistoryStore(file);
  assert.equal((await calls.stats('t1')).callsHandled, 0);
  assert.equal((await calls.statsSince('t1')).callsHandled, 1);
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).calls.a.synthetic, true);
});


test('Marked outcome events cannot leave materialized test recoveries or revenue in customer totals', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'br-result-outcomes-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const data = new RecoveryStore(path.join(dir, 'state.json'));
  const engine = new RecoveryEngine({ store: data, tenant: { tenantId: 't1' } });
  const lead = await engine.ingest({ id: 'real-lead', tenantId: 't1', type: 'web_lead', occurredAt: at });
  await data.patchOpportunity(lead.opportunity.id, { createdAt: at });
  await engine.ingest({ id: 'test-booking', tenantId: 't1', type: 'booking_confirmed', opportunityId: lead.opportunity.id, occurredAt: at, synthetic: true });
  await engine.ingest({ id: 'test-revenue', tenantId: 't1', type: 'revenue_confirmed', opportunityId: lead.opportunity.id, occurredAt: at, amount: 777, metadata: { synthetic: true } });
  const before = await data.snapshot();
  const brief = await ownerDailyBrief(data, 't1', { now });
  const proof = await radarProof(data, 't1');
  assert.deepEqual([brief.recoveredOpportunities, brief.confirmedRevenue, proof.recoveredOpportunities, proof.confirmedRevenue], [0, 0, 0, 0]);
  assert.equal(proof.dataCoverage.excludedLinkedOpportunities, 1);
  assert.match(proof.dataCoverage.notice, /may omit genuine activity on mixed real\/test records/);
  assert.deepEqual(await data.snapshot(), before);
});

test('Foreign marked outcomes cannot suppress a tenant-owned reporting unit', async () => {
  const data = snapshot({
    opportunities: { a: opportunity('a', { recovered: true, recoveredAt: at }) },
    attribution: { a: { tenantId: 't1', opportunityId: 'a', recovered: true, confirmedRevenue: 321, confirmedAt: at } },
    events: [{ id: 'foreign', tenantId: 't2', opportunityId: 'a', synthetic: true, type: 'booking_confirmed' }],
    actions: { foreign: { tenantId: 't2', opportunityId: 'a', synthetic: true } },
  });
  const result = await radarProof(store(data), 't1');
  assert.equal(result.opportunitiesCaptured, 1);
  assert.equal(result.recoveredOpportunities, 1);
  assert.equal(result.confirmedRevenue, 321);
});


test('Orphan attribution is excluded consistently and duplicate money fails closed without guessing', async () => {
  const orphan = snapshot({ attribution: { orphan: { tenantId: 't1', opportunityId: 'missing', confirmedAt: at, confirmedRevenue: 999 } } });
  const owner = await ownerDailyBrief(store(orphan), 't1', { now });
  assert.equal(owner.confirmedRevenue, 0);
  assert.equal(owner.dataCoverage.excludedOrphanAttribution, 1);
  const data = snapshot({
    opportunities: { a: opportunity('a', { recovered: true, recoveredAt: at }) },
    attribution: {
      a: { tenantId: 't1', opportunityId: 'a', recovered: true, confirmedAt: at, confirmedRevenue: 60, estimatedRecoveredValue: 50 },
      duplicate: { tenantId: 't1', opportunityId: 'a', recovered: true, confirmedAt: at, confirmedRevenue: 60, estimatedRecoveredValue: 50 },
    },
  });
  const proof = await radarProof(store(data), 't1');
  assert.equal(proof.recoveredOpportunities, 1);
  assert.equal(proof.recoveryRate, 1);
  assert.deepEqual([proof.confirmedRevenue, proof.estimatedRecoveredValue, proof.estimatedOpportunityValue], [null, null, null]);
  assert.equal((await ownerDailyBrief(store(data), 't1', { now })).confirmedRevenue, null);
  assert.equal(proof.dataCoverage.duplicateAttributionOpportunities, 1);
  assert.match(proof.dataCoverage.notice, /Duplicate attribution makes attribution-based monetary totals unavailable/);
});


test('All-tenant reporting joins synthetic source and child markers within the owning tenant', async () => {
  const data = snapshot({
    opportunities: { local: opportunity('local', { sourceEventId: 'shared' }), foreign: opportunity('foreign', { tenantId: 't2', sourceEventId: 'shared' }) },
    events: [{ id: 'shared', tenantId: 't2', synthetic: true }, { id: 'bad-reference', tenantId: 't2', opportunityId: 'local', synthetic: true }],
    attribution: { wrong: { tenantId: 't2', opportunityId: 'local', confirmedRevenue: 999 } },
  });
  const all = await radarProof(store(data));
  assert.equal(all.opportunitiesCaptured, 1);
  assert.equal(all.confirmedRevenue, 0);
  assert.equal((await radarProof(store(data), 't1')).opportunitiesCaptured, 1);
  assert.equal((await radarProof(store(data), 't2')).opportunitiesCaptured, 0);
});


test('Ambiguous attribution cannot select an arbitrary risk value or attention-item amount', async () => {
  const data = snapshot({
    opportunities: { a: opportunity('a', { status: 'open', type: 'web_lead', estimatedOpportunityValue: 200 }) },
    attribution: {
      a: { tenantId: 't1', opportunityId: 'a', estimatedOpportunityValue: 400 },
      duplicate: { tenantId: 't1', opportunityId: 'a', estimatedOpportunityValue: 500 },
    },
  });
  const brief = await ownerDailyBrief(store(data), 't1', { now });
  assert.equal(brief.openRevenueLeaks, 1);
  assert.equal(brief.estimatedValueAtRisk, null);
  assert.equal(brief.topAttentionItems[0].estimatedOpportunityValue, null);
  assert.equal((await radarProof(store(data), 't1')).bySource.unknown.estimatedValue, 200);
});

test('The pilot reporting adapter preserves unavailable confirmed revenue without changing admission status', async () => {
  const { proofPilotScorecard } = await import('../src/proof-pilot-control.js');
  const unavailable = proofPilotScorecard({ status: 'ACTIVE', callsHandled: 3, confirmedRevenue: null });
  assert.equal(unavailable.confirmedRevenue, null);
  assert.equal(unavailable.status, 'ACTIVE');
  assert.equal(unavailable.callsHandled, 3);
  assert.equal(proofPilotScorecard({ confirmedRevenue: 0 }).confirmedRevenue, 0);
  assert.equal(proofPilotScorecard({ confirmedRevenue: 321 }).confirmedRevenue, 321);
});
