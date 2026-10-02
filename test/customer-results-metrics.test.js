import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { ownerDailyBrief } from '../src/growth-intelligence.js';
import { radarProof } from '../src/recovery/radarproof.js';
import { RecoveryStore } from '../src/recovery/store.js';
import { RecoveryEngine } from '../src/recovery/engine.js';

const now = new Date('2026-10-02T12:00:00Z');
const recent = '2026-10-02T10:00:00Z';
const old = '2026-09-01T00:00:00Z';
const future = '2026-10-03T12:00:00Z';
const opportunity = (id, extra = {}) => ({ id, tenantId: 't1', createdAt: old, status: 'closed', ...extra });
const storeFor = (opportunities = {}, attribution = {}, extra = {}) => ({ snapshot: async () => ({ opportunities, attribution, events: [], actions: {}, ...extra }) });

test('Owner Brief counts recovery time independently of opportunity creation time', async () => {
  const oldLeadOnly = storeFor({ oldLead: opportunity('oldLead', { recovered: true, recoveredAt: recent }) });
  assert.equal((await ownerDailyBrief(oldLeadOnly, 't1', { now })).recoveredOpportunities, 1);
  const store = storeFor({
    oldLead: opportunity('oldLead', { recovered: true, recoveredAt: recent }),
    oldRecovery: opportunity('oldRecovery', { createdAt: recent, recovered: true, recoveredAt: old }),
    newLead: opportunity('newLead', { createdAt: recent }),
  });
  const brief = await ownerDailyBrief(store, 't1', { now });
  assert.equal(brief.newOpportunities, 2);
  assert.equal(brief.recoveredOpportunities, 1);
  assert.deepEqual(brief.recoveryEvidence, { status: 'available', timestampField: 'recoveredAt', knownRecoveredOpportunities: 1, undatedRecoveredOpportunities: 0, reason: null });
});

test('Owner Brief fails closed when a recovery date is missing or invalid', async () => {
  for (const recoveredAt of [undefined, '', ' ', null, false, true, {}, 'invalid', Infinity]) {
    const brief = await ownerDailyBrief(storeFor({
      known: opportunity('known', { recovered: true, recoveredAt: recent }),
      legacy: opportunity('legacy', { createdAt: recent, recovered: true, recoveredAt }),
    }), 't1', { now });
    assert.equal(brief.recoveredOpportunities, null);
    assert.equal(brief.recoveryEvidence.status, 'unavailable');
    assert.equal(brief.recoveryEvidence.knownRecoveredOpportunities, 1);
    assert.equal(brief.recoveryEvidence.undatedRecoveredOpportunities, 1);
  }
});

test('Owner Brief preserves epoch-millisecond timestamps accepted by the ingestion engine', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'br-results-epoch-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new RecoveryStore(path.join(dir, 'state.json'));
  const engine = new RecoveryEngine({ store, tenant: { tenantId: 't1' } });
  const timestamp = Date.parse(recent);
  const lead = await engine.ingest({ id: 'numeric-lead', tenantId: 't1', type: 'web_lead', occurredAt: timestamp });
  await store.patchOpportunity(lead.opportunity.id, { createdAt: timestamp });
  await engine.ingest({ id: 'numeric-booking', tenantId: 't1', type: 'booking_confirmed', opportunityId: lead.opportunity.id, occurredAt: timestamp });
  await engine.ingest({ id: 'numeric-revenue', tenantId: 't1', type: 'revenue_confirmed', opportunityId: lead.opportunity.id, occurredAt: timestamp, amount: 123 });
  const brief = await ownerDailyBrief(store, 't1', { now });
  assert.equal(brief.newOpportunities, 1);
  assert.equal(brief.recoveredOpportunities, 1);
  assert.equal(brief.confirmedRevenue, 123);
  assert.equal(brief.recoveryEvidence.status, 'available');
});

test('Owner Brief timestamps are bounded, include the lower boundary, and reject future records', async () => {
  const boundary = '2026-10-01T12:00:00Z';
  const store = storeFor({
    boundary: opportunity('boundary', { createdAt: boundary, recovered: true, recoveredAt: boundary }),
    future: opportunity('future', { createdAt: future, recovered: true, recoveredAt: future }),
    tooOld: opportunity('tooOld', { createdAt: old, recovered: true, recoveredAt: '2026-10-01T11:59:59.999Z' }),
  }, {
    boundary: { tenantId: 't1', opportunityId: 'boundary', confirmedAt: boundary, confirmedRevenue: 123 },
    future: { tenantId: 't1', opportunityId: 'future', confirmedAt: future, confirmedRevenue: 999 },
  });
  const brief = await ownerDailyBrief(store, 't1', { now });
  assert.equal(brief.newOpportunities, 1);
  assert.equal(brief.recoveredOpportunities, 1);
  assert.equal(brief.confirmedRevenue, 123);
});

test('Other tenant recoveries, including undated ones, do not affect the Owner Brief', async () => {
  const brief = await ownerDailyBrief(storeFor({
    a: opportunity('a', { recovered: true, recoveredAt: recent }),
    b: opportunity('b', { tenantId: 't2', recovered: true }),
    c: opportunity('c', { tenantId: 't2', createdAt: recent, recovered: true, recoveredAt: recent }),
  }), 't1', { now });
  assert.equal(brief.recoveredOpportunities, 1);
  assert.equal(brief.newOpportunities, 0);
  assert.equal(brief.recoveryEvidence.status, 'available');
});

test('Conflicting tenant attribution never borrows a local opportunity ID', async () => {
  const store = storeFor({ a: opportunity('a', { status: 'open', type: 'web_lead', estimatedOpportunityValue: 200 }) }, {
    a: { opportunityId: 'a', tenantId: 't2', recovered: true, confirmedAt: recent, confirmedRevenue: 999, estimatedOpportunityValue: 999 },
  });
  const brief = await ownerDailyBrief(store, 't1', { now });
  assert.equal(brief.confirmedRevenue, 0);
  assert.equal(brief.estimatedValueAtRisk, 200);
  const proof = await radarProof(store, 't1');
  assert.equal(proof.confirmedRevenue, 0);
  assert.equal(proof.estimatedOpportunityValue, 0);
  assert.equal(proof.recoveredOpportunities, 0);
});

test('Legacy unscoped attribution still requires a known tenant-owned opportunity', async () => {
  const store = storeFor({ a: opportunity('a') }, {
    good: { opportunityId: 'a', confirmedAt: recent, confirmedRevenue: 123 },
    orphan: { opportunityId: 'missing', confirmedAt: recent, confirmedRevenue: 999 },
  });
  assert.equal((await ownerDailyBrief(store, 't1', { now })).confirmedRevenue, 123);
  assert.equal((await radarProof(store, 't1')).confirmedRevenue, 123);
});

test('No records yields observed zero counts, unavailable rate and latency, and no estimated revenue substitution', async () => {
  const brief = await ownerDailyBrief(storeFor(), 't1', { now });
  assert.equal(brief.newOpportunities, 0);
  assert.equal(brief.recoveredOpportunities, 0);
  assert.equal(brief.confirmedRevenue, 0);
  const proof = await radarProof(storeFor(), 't1');
  assert.equal(proof.recoveryRate, null);
  assert.equal(proof.medianResponseSeconds, null);
  const estimated = await radarProof(storeFor({ a: opportunity('a', { recovered: true }) }, {
    a: { opportunityId: 'a', tenantId: 't1', recovered: true, estimatedOpportunityValue: 5000, estimatedRecoveredValue: 4000 },
  }), 't1');
  assert.equal(estimated.estimatedRecoveredValue, 4000);
  assert.equal(estimated.confirmedRevenue, 0);
});

test('Actual recovery event records its outcome timestamp and keeps explicit revenue separate', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'br-results-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new RecoveryStore(path.join(dir, 'state.json'));
  const engine = new RecoveryEngine({ store, tenant: { tenantId: 't1', economics: { defaultAverageJobValue: 5000 } } });
  const lead = await engine.ingest({ id: 'source-lead', tenantId: 't1', type: 'web_lead', occurredAt: old });
  await store.patchOpportunity(lead.opportunity.id, { createdAt: old });
  const event = { id: 'source-booking', tenantId: 't1', type: 'booking_confirmed', opportunityId: lead.opportunity.id, occurredAt: recent };
  await engine.ingest(event);
  assert.equal((await engine.ingest(event)).duplicate, true);
  let brief = await ownerDailyBrief(store, 't1', { now });
  assert.equal(brief.recoveredOpportunities, 1);
  assert.equal(brief.confirmedRevenue, 0);
  await engine.ingest({ id: 'source-revenue', tenantId: 't1', type: 'revenue_confirmed', source: 'authorized-test-ledger', opportunityId: lead.opportunity.id, occurredAt: recent, amount: 321 });
  brief = await ownerDailyBrief(store, 't1', { now });
  assert.equal(brief.confirmedRevenue, 321);
  const data = await store.snapshot();
  assert.equal(data.opportunities[lead.opportunity.id].recoveredAt, recent);
  assert.equal(data.attribution[lead.opportunity.id].confirmedRevenueSource, 'authorized-test-ledger');
  assert.equal(data.attribution[lead.opportunity.id].confirmedAt, recent);
  assert.equal(data.events.filter(x => x.id === 'source-booking').length, 1);
});

test('Owner Brief UI renders unavailable recovery with an explanation and preserves zero', async () => {
  const html = await fs.readFile(new URL('../public/owner-brief.html', import.meta.url), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const nodes = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, { value: '', textContent: '', className: '', innerHTML: '' }]));
  let brief = await ownerDailyBrief(storeFor({ a: opportunity('a', { recovered: true }) }), 't1', { now });
  const context = vm.createContext({ ...nodes, document: { getElementById: id => nodes[id] }, sessionStorage: { getItem: () => '', setItem() {} }, fetch: async () => ({ ok: true, json: async () => ({ brief }) }), Intl });
  vm.runInContext(script.replace('$("load").onclick=load;load();', '$("load").onclick=load;'), context);
  await context.load();
  assert.equal(nodes.recovered.textContent, 'Unavailable');
  assert.match(nodes.recoveryNote.textContent, /missing or invalid/);
  brief = await ownerDailyBrief(storeFor(), 't1', { now });
  await context.load();
  assert.equal(nodes.recovered.textContent, 0);
  assert.equal(nodes.recoveryNote.textContent, '');
});
