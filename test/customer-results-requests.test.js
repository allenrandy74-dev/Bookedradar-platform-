import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { extractFixtureScript } from './fixtures/dashboard-script.js';

const metricIds = {
  'owner-brief': ['newOpp', 'recovered', 'revenue', 'leaks', 'calls', 'transfers', 'gaps', 'memberships', 'reviews', 'risk'],
  'radarproof-dashboard': ['captured', 'recovered', 'estimated', 'confirmed', 'callsHandled', 'humanTransfers', 'spamScreened', 'callsWithTranscript', 'knowledgeGaps', 'rate', 'pending'],
};

function element() {
  let content = '';
  return {
    value: '', className: '',
    get textContent() { return content; }, set textContent(value) { content = String(value); },
    get innerHTML() { return content; }, set innerHTML(value) { content = String(value); },
  };
}

async function harness(page) {
  const html = await fs.readFile(new URL(`../public/${page}.html`, import.meta.url), 'utf8');
  const nodes = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, element()]));
  const storage = new Map([['br_tenant', 't1'], ['br_admin_token', 'fixture-token']]);
  const requests = [];
  const context = vm.createContext({
    ...nodes, document: { getElementById: id => nodes[id] },
    sessionStorage: { getItem: key => storage.get(key) || '', setItem: (key, value) => storage.set(key, value) },
    location: { search: '?tenant=t1' }, URLSearchParams, Intl, setInterval() {},
    fetch: (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })),
  });
  const script = extractFixtureScript(html)
    .replace('$("load").onclick=load;load();', '$("load").onclick=load;')
    .replace('load();\nsetInterval(load,30000);', 'setInterval(load,30000);');
  vm.runInContext(script, context);
  function payload(amount = 321) {
    const data = {
      newOpportunities: 4, recoveredOpportunities: 2, confirmedRevenue: amount,
      openRevenueLeaks: 1, callsHandled: 3, humanTransfers: 1, knowledgeGaps: 1,
      membershipRenewalsDue: 1, reviewEligibleJobs: 1, estimatedValueAtRisk: 500,
      topAttentionItems: [], recoveryEvidence: { status: 'unavailable' },
      opportunitiesCaptured: 4, recoveryRate: 0.5, estimatedRecoveredValue: 500,
      pendingActions: 1, blockedActions: 1, disclaimer: 'fixture diagnostic estimates',
      bySource: { fixture: { opportunities: 4, recovered: 2, estimatedValue: 500 } },
      dataCoverage: { notice: 'fixture coverage' }, callActivity: { callsHandled: 3, humanTransfers: 1 },
    };
    return page === 'owner-brief' ? { brief: data } : { report: data };
  }
  const respond = (index, amount = 321) => requests[index].resolve({ ok: true, json: async () => payload(amount) });
  const money = () => nodes[page === 'owner-brief' ? 'revenue' : 'confirmed'].textContent;
  const assertCleared = () => {
    for (const id of metricIds[page]) assert.equal(nodes[id].textContent, 'Unavailable', id);
    assert.match(nodes.coverage.textContent, /coverage has not been verified/);
    assert.doesNotMatch(nodes[page === 'owner-brief' ? 'attention' : 'sources'].textContent, /fixture/);
    if (page === 'owner-brief') assert.equal(nodes.recoveryNote.textContent, '');
    else assert.equal(nodes.blocked.textContent, '');
  };
  return { nodes, storage, requests, context, payload, respond, money, assertCleared };
}

for (const page of Object.keys(metricIds)) {
  test(`${page} clears every prior metric and explanation while a refresh is pending`, async () => {
    const h = await harness(page);
    const first = h.context.load(); h.respond(0); await first;
    assert.equal(h.money(), '$321');
    const next = h.context.load();
    h.assertCleared(); assert.equal(h.nodes.status.textContent, 'Loading…');
    h.respond(1, 0); await next;
    assert.equal(h.money(), '$0'); assert.equal(h.nodes.status.textContent, 'Live');
  });

  for (const failure of ['http', 'network', 'json']) {
    test(`${page} keeps all metrics unavailable after ${failure} failure following success`, async () => {
      const h = await harness(page);
      const first = h.context.load(); h.respond(0); await first;
      const next = h.context.load();
      if (failure === 'http') h.requests[1].resolve({ ok: false });
      if (failure === 'network') h.requests[1].reject(new Error('fixture network failure'));
      if (failure === 'json') h.requests[1].resolve({ ok: true, json: async () => { throw new Error('fixture invalid JSON'); } });
      await next; h.assertCleared();
      assert.equal(h.nodes.status.textContent, page === 'owner-brief' ? 'Unavailable' : 'Data unavailable');
    });
  }

  test(`${page} ignores an older response that arrives after a newer successful refresh`, async () => {
    const h = await harness(page);
    const older = h.context.load(); const newer = h.context.load();
    h.respond(1, 222); await newer; h.respond(0, 111); await older;
    assert.equal(h.money(), '$222'); assert.equal(h.nodes.status.textContent, 'Live');
  });

  test(`${page} ignores an older request failure after a newer successful refresh`, async () => {
    const h = await harness(page);
    const older = h.context.load(); const newer = h.context.load();
    h.respond(1, 222); await newer; h.requests[0].reject(new Error('old fixture failure')); await older;
    assert.equal(h.money(), '$222'); assert.equal(h.nodes.status.textContent, 'Live');
  });

  test(`${page} checks request order after delayed JSON parsing`, async () => {
    const h = await harness(page);
    let finishJson;
    const older = h.context.load();
    h.requests[0].resolve({ ok: true, json: () => new Promise(resolve => { finishJson = resolve; }) });
    await Promise.resolve();
    const newer = h.context.load(); h.respond(1, 222); await newer;
    finishJson(h.payload(111)); await older;
    assert.equal(h.money(), '$222'); assert.equal(h.nodes.status.textContent, 'Live');
  });

  test(`${page} editing the token immediately clears and invalidates outstanding results`, async () => {
    const h = await harness(page);
    const first = h.context.load(); h.respond(0); await first;
    const pending = h.context.load();
    h.nodes.token.value = 'different-fixture-token'; h.nodes.token.oninput();
    h.assertCleared(); assert.equal(h.nodes.status.textContent, 'Refresh required');
    h.respond(1); await pending; h.assertCleared();
    assert.equal(h.nodes.status.textContent, 'Refresh required');
  });
}

test('Owner Brief tenant editing clears old values before refresh and rejects the old tenant response', async () => {
  const h = await harness('owner-brief');
  const first = h.context.load(); h.respond(0); await first;
  const oldTenant = h.context.load();
  h.nodes.tenant.value = 't2'; h.nodes.tenant.oninput(); h.assertCleared();
  const newTenant = h.context.load();
  assert.match(h.requests[2].url, /tenant=t2$/);
  h.respond(2, 222); await newTenant; h.respond(1, 111); await oldTenant;
  assert.equal(h.nodes.tenant.value, 't2'); assert.equal(h.money(), '$222');
  assert.equal(h.nodes.status.textContent, 'Live');
});

test('Owner Brief failed tenant switch never labels old tenant amounts with the new tenant', async () => {
  const h = await harness('owner-brief');
  const first = h.context.load(); h.respond(0); await first;
  h.nodes.tenant.value = 't2'; h.nodes.tenant.oninput();
  const next = h.context.load(); h.requests[1].resolve({ ok: false }); await next;
  assert.equal(h.nodes.tenant.value, 't2'); h.assertCleared();
});

test('RadarProof auto-refresh does not revive saved-token data while a different token is being edited', async () => {
  const h = await harness('radarproof-dashboard');
  const first = h.context.load(); h.respond(0); await first;
  h.nodes.token.value = 'different-fixture-token'; h.nodes.token.oninput();
  await h.context.load();
  assert.equal(h.requests.length, 1); h.assertCleared();
  assert.equal(h.nodes.status.textContent, 'Refresh required');
  h.nodes.saveToken.onclick();
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].options.headers.Authorization, 'Bearer different-fixture-token');
  h.respond(1, 222); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.money(), '$222');
});
