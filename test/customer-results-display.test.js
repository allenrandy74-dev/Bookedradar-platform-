import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

for (const page of ['owner-brief', 'radarproof-dashboard']) {
  test(`${page} preserves unavailable money, genuine zero and synthetic coverage explanations`, async () => {
    const html = await fs.readFile(new URL(`../public/${page}.html`, import.meta.url), 'utf8');
    const nodes = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, { value: '', textContent: '', className: '', innerHTML: '' }]));
    const notice = 'Unmarked history has not been verified. Duplicate attribution makes monetary totals unavailable.';
    const result = { recoveryRate: null, confirmedRevenue: null, estimatedRecoveredValue: null, recoveredOpportunities: 0, dataCoverage: { notice }, topAttentionItems: [], bySource: {} };
    const payload = page === 'owner-brief' ? { brief: result } : { report: result };
    let script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    script = script.replace('$("load").onclick=load;load();', '$("load").onclick=load;').replace('load();\nsetInterval(load,30000);', 'setInterval(load,30000);');
    const context = vm.createContext({ ...nodes, document: { getElementById: id => nodes[id] }, sessionStorage: { getItem: () => '', setItem() {} }, location: { search: '' }, URLSearchParams, Intl, setInterval() {}, fetch: async () => ({ ok: true, json: async () => payload }) });
    vm.runInContext(script, context);
    await context.load();
    assert.equal(nodes[page === 'owner-brief' ? 'revenue' : 'confirmed'].textContent, 'Unavailable');
    assert.equal(nodes.coverage.textContent, notice);
    assert.match(html, />Transfers initiated</);
    assert.match(html, /does not establish a completed human connection/);
    if (page === 'radarproof-dashboard') {
      assert.equal(nodes.rate.textContent, 'Unavailable');
      assert.equal(nodes.estimated.textContent, 'Unavailable');
    }
    result.recoveryRate = 0; result.confirmedRevenue = 0; result.estimatedRecoveredValue = 0;
    await context.load();
    assert.equal(nodes[page === 'owner-brief' ? 'revenue' : 'confirmed'].textContent, '$0');
    if (page === 'radarproof-dashboard') assert.equal(nodes.rate.textContent, '0%');
  });
}
