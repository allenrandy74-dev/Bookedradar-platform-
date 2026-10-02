import { test as base, expect } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
export const definitions = {
  owner: { file: 'owner-brief.html', endpoint: '/api/v1/owner-brief', refresh: '#load', money: '#revenue', detail: '#attention', metrics: ['newOpp','recovered','revenue','leaks','calls','transfers','gaps','memberships','reviews','risk'] },
  radar: { file: 'radarproof-dashboard.html', endpoint: '/api/v1/radarproof', refresh: '#saveToken', money: '#confirmed', detail: '#sources', metrics: ['captured','recovered','estimated','confirmed','callsHandled','humanTransfers','spamScreened','callsWithTranscript','knowledgeGaps','rate','pending'] }
};
export function payload(kind, amount = 321, overrides = {}) {
  const data = {
    newOpportunities: 4, opportunitiesCaptured: 4, recoveredOpportunities: 2,
    confirmedRevenue: amount, estimatedRecoveredValue: 500, estimatedValueAtRisk: 600,
    openRevenueLeaks: 1, callsHandled: 3, humanTransfers: 1, knowledgeGaps: 1,
    membershipRenewalsDue: 1, reviewEligibleJobs: 1, recoveryRate: 0.5,
    pendingActions: 1, blockedActions: 1,
    recoveryEvidence: { status: 'unavailable' },
    dataCoverage: { notice: 'SYNTHETIC QA: marked tests excluded; unmarked history is unverified; mixed-lineage quarantine may omit genuine activity.' },
    disclaimer: 'SYNTHETIC QA: diagnostic estimates are not confirmed revenue or payment settlement.',
    callActivity: { callsHandled: 3, humanTransfers: 1, spamScreened: 0, callsWithTranscript: 2, knowledgeGaps: 1 },
    bySource: { 'synthetic-web': { opportunities: 4, recovered: 2, estimatedValue: 500 } },
    topAttentionItems: [{ priority: 'high', type: 'synthetic_follow_up', source: 'synthetic-web', ageHours: 2, recommendedNextAction: 'SYNTHETIC QA follow-up only', estimatedOpportunityValue: 600 }],
    ...overrides
  };
  return kind === 'owner' ? { brief: data } : { report: data };
}
export const test = base.extend({
  qa: async ({ context, page, browser }, use, info) => {
    const pages = {};
    for (const d of Object.values(definitions)) pages['/dashboard/' + d.file] = await fs.readFile(root + 'public/' + d.file);
    const requests = [], allowed = [], denied = [], serverUnexpected = [], errors = [];
    let expectedDenied = [], abortNext = false;
    const injectedNetworkFailures = [];
    page.on('pageerror', e => errors.push(e.message));
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      res.setHeader('Cache-Control', 'no-store');
      if (req.method !== 'GET') { serverUnexpected.push(req.method + ' ' + req.url); res.writeHead(405); res.end(); return; }
      if (pages[url.pathname]) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(pages[url.pathname]); return; }
      if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      if (Object.values(definitions).some(d => d.endpoint === url.pathname) &&
          url.searchParams.get('tenant')?.startsWith('qa-') &&
          /^Bearer qa-[a-z-]+$/.test(req.headers.authorization || '')) {
        requests.push({
          url: req.url, authorization: req.headers.authorization,
          reply(data, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); },
          invalid() { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{ invalid synthetic JSON'); },
          fail() { req.socket.destroy(); },
          startJSON() { res.writeHead(200, { 'Content-Type': 'application/json' }); res.flushHeaders(); res.write(' '); },
          finishJSON(data) { res.end(JSON.stringify(data)); }
        });
        return;
      }
      serverUnexpected.push(req.method + ' ' + req.url);
      res.writeHead(404); res.end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      const document = Object.hasOwn(pages, url.pathname) && req.resourceType() === 'document';
      const api = Object.values(definitions).some(d => d.endpoint === url.pathname) &&
        url.searchParams.get('tenant')?.startsWith('qa-') &&
        /^Bearer qa-[a-z-]+$/.test(req.headers().authorization || '');
      const favicon = url.pathname === '/favicon.ico';
      if (url.origin === origin && req.method() === 'GET' && (document || api || favicon)) {
        allowed.push({ method: req.method(), path: url.pathname, tenant: url.searchParams.get('tenant') });
        if (api && abortNext) {
          abortNext = false;
          requests.push({ url: url.pathname + url.search, authorization: req.headers().authorization,
            async fail() { injectedNetworkFailures.push(req.url()); await route.abort('failed'); } });
          return;
        }
        await route.continue();
      } else {
        denied.push(req.method() + ' ' + req.url());
        await route.abort('blockedbyclient');
      }
    });
    await context.routeWebSocket('**/*', ws => { denied.push('WS ' + ws.url()); ws.close(); });
    await context.addInitScript(() => {
      // Synthetic storage only. Native fetch, Response, DOM and page scripts stay unchanged.
      sessionStorage.setItem('br_tenant', 'qa-a');
      sessionStorage.setItem('br_admin_token', 'qa-token-a');
    });
    await page.clock.install({ time: new Date('2026-10-02T12:00:00Z') });
    const qa = {
      page, origin, requests, denied,
      failNextRequest() { abortNext = true; },
      expectDenied(values) { expectedDenied = values; },
      async open(kind, tenant = 'qa-a') { await page.goto(origin + '/dashboard/' + definitions[kind].file + '?tenant=' + tenant, { waitUntil: 'domcontentloaded' }); },
      async request(n) { await expect.poll(() => requests.length).toBeGreaterThan(n); return requests[n]; },
      async loaded(kind, n = 0, amount = 321, overrides = {}) { (await qa.request(n)).reply(payload(kind, amount, overrides)); await expect(page.locator('#status')).toHaveText('Live'); },
      async refresh(kind) { await page.locator(definitions[kind].refresh).click(); },
      async cleared(kind) {
        for (const id of definitions[kind].metrics) await expect(page.locator('#' + id)).toHaveText('Unavailable');
        await expect(page.locator('#coverage')).toHaveText('Data unavailable; synthetic marker coverage has not been verified.');
        await expect(page.locator(definitions[kind].detail)).not.toContainText('SYNTHETIC QA');
        await expect(page.locator(definitions[kind].detail)).not.toContainText('synthetic-web');
        if (kind === 'owner') await expect(page.locator('#recoveryNote')).toBeEmpty();
        else { await expect(page.locator('#blocked')).toBeEmpty(); await expect(page.locator('#disclaimer')).toHaveText('RadarProof data is unavailable.'); }
      },
      async settle() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); },
      async screenshot(name) { await info.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' }); }
    };
    try { await use(qa); }
    finally {
      if (info.status !== info.expectedStatus && !page.isClosed()) await qa.screenshot('failure-state');
      await info.attach('network-and-source-evidence', { body: Buffer.from(JSON.stringify({
        browser: browser.version(), viewport: page.viewportSize(), commit: process.env.QA_COMMIT || 'local-uncommitted',
        sourceSHA256: Object.fromEntries(Object.entries(pages).map(([p, bytes]) => [p, crypto.createHash('sha256').update(bytes).digest('hex')])),
        allowed, denied, expectedDenied, injectedNetworkFailures, serverUnexpected, pageErrors: errors
      }, null, 2)), contentType: 'application/json' });
      await context.close();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      expect(denied.sort(), 'unexpected requests must fail closed').toEqual(expectedDenied.sort());
      expect(serverUnexpected).toEqual([]);
      expect(errors).toEqual([]);
    }
  }
});
export { expect };
