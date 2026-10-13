import { test as base, expect } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { allowedRequest, syntheticBody, signupPath, chatPath, sourceContentType, syntheticChatDocument } from './public-network-policy.mjs';
const root = fileURLToPath(new URL('../../../', import.meta.url));
export const test = base.extend({
  publicQA: async ({ context, page, browser }, use, info) => {
    const source = {
      '/dashboard/signup.html': 'public/signup.html',
      '/dashboard/pilot-signup.js': 'public/pilot-signup.js',
      '/public/bookedradar-chat.js': 'public/bookedradar-chat.js',
      '/website/src/demo-chat.js': 'website/src/demo-chat.js'
    };
    const assets = Object.fromEntries(await Promise.all(Object.entries(source).map(async ([url, path]) => [url, await fs.readFile(root + path)])));
    const requests = [], denied = [], unexpected = [], errors = [];
    const consoleErrors = [], expectedConsoleFailures = [];
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push({ text: message.text(), location: message.location() });
    });
    function expectedResourceError(url, detail) {
      expectedConsoleFailures.push({ url, text: 'Failed to load resource: ' + detail });
    }
    let expectedDenied = [], origin, abortNext = false, serverPosts = 0;
    const server = http.createServer(async (req, res) => {
      if (!allowedRequest(origin + req.url, req.method, origin)) {
        unexpected.push(req.method + ' ' + req.url); res.writeHead(404); res.end(); return;
      }
      res.setHeader('Cache-Control', 'no-store');
      if (req.method === 'GET') {
        if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
        if (assets[req.url]) {
          res.setHeader('Content-Type', sourceContentType(req.url));
          res.end(assets[req.url]); return;
        }
        // Synthetic embedding page only; production script bytes are unchanged.
        const src = req.url === '/qa/demo.html' ? '/website/src/demo-chat.js' : '/public/bookedradar-chat.js';
        res.setHeader('Content-Type', sourceContentType(req.url));
        res.end(syntheticChatDocument(src, origin));
        return;
      }
      try {
        let raw = '';
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 8192) throw new Error('oversized synthetic input');
        }
        const body = JSON.parse(raw);
        if (!syntheticBody(req.url, body)) throw new Error('non-synthetic input');
        serverPosts++;
        requests.push({ path: req.url, body,
          reply(data, status = 200) {
            if (status >= 400) expectedResourceError(origin + req.url, `the server responded with a status of ${status} (${http.STATUS_CODES[status]})`);
            res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data));
          },
          invalid() { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{ invalid synthetic JSON'); },
          startJSON() { res.writeHead(200, { 'Content-Type': 'application/json' }); res.flushHeaders(); res.write(' '); },
          finishJSON(data) { res.end(JSON.stringify(data)); },
          expectAbort() { expectedResourceError(origin + req.url, 'net::ERR_ABORTED'); }
        });
      } catch {
        unexpected.push('invalid synthetic input');
        res.writeHead(400); res.end();
      }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = 'http://127.0.0.1:' + server.address().port;
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const request = route.request();
      const target = new URL(request.url());
      const bodySafe = request.method() !== 'POST' || (() => {
        try { return syntheticBody(target.pathname + target.search, request.postDataJSON()); }
        catch { return false; }
      })();
      if (allowedRequest(request.url(), request.method(), origin) && bodySafe) {
        if (abortNext && request.method() === 'POST') {
          abortNext = false;
          requests.push({ path: target.pathname + target.search, body: request.postDataJSON(), injected: true,
            async fail() { expectedResourceError(request.url(), 'net::ERR_FAILED'); await route.abort('failed'); }
          });
          return;
        }
        await route.continue();
      }
      else {
        denied.push(request.method() + ' ' + request.url());
        expectedResourceError(request.url(), 'net::ERR_BLOCKED_BY_CLIENT.Inspector');
        await route.abort('blockedbyclient');
      }
    });
    await context.routeWebSocket('**/*', socket => { denied.push('WS ' + socket.url()); socket.close(); });
    await page.clock.install({ time: new Date('2026-10-13T12:00:00Z') });
    await page.clock.pauseAt(new Date('2026-10-13T12:00:01Z'));
    const qa = {
      origin, requests,
      get serverPosts() { return serverPosts; },
      failNextRequest() { abortNext = true; },
      expectDenied(values) { expectedDenied = values; },
      async open(kind) { await page.goto(origin + (kind === 'signup' ? '/dashboard/signup.html' : `/qa/${kind}.html`), { waitUntil: 'domcontentloaded' }); },
      async request(index = 0) { await expect.poll(() => requests.length).toBeGreaterThan(index); return requests[index]; },
      async fillSignup(preference = 'email') {
        await page.getByLabel('Your name', { exact: true }).fill('Synthetic Visitor');
        await page.getByLabel('Business name', { exact: true }).fill('Synthetic QA');
        await page.getByLabel('Email address', { exact: true }).fill('visitor@example.invalid');
        await page.locator('#contact-preference').selectOption(preference);
        if (preference === 'phone') await page.locator('#phone').fill('+12025550100');
      },
      async screenshot(name) { await info.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' }); }
    };
    try { await use(qa); }
    finally {
      const unexpectedConsoleErrors = consoleErrors.filter(error => !expectedConsoleFailures.some(expected => expected.url === error.location.url && expected.text === error.text));
      console.log('QA_PUBLIC_BROWSER_EVIDENCE', JSON.stringify({
        test: info.title, browser: browser.version(), viewport: page.viewportSize(),
        commit: process.env.QA_COMMIT || 'local-uncommitted',
        syntheticRequests: requests.length, serverPosts, injectedNetworkFailures: requests.filter(request => request.injected).length, denied: denied.length,
        unexpectedRequests: unexpected.length, pageErrors: errors.length,
        unexpectedConsoleErrors: unexpectedConsoleErrors.length
      }));
      await info.attach('public-network-and-source-evidence', { body: Buffer.from(JSON.stringify({
        browser: browser.version(), commit: process.env.QA_COMMIT || 'local-uncommitted',
        viewport: page.viewportSize(), syntheticRequests: requests.map(({ path, injected }) => ({ path, injectedNetworkFailure: !!injected })),
        sourceSHA256: Object.fromEntries(Object.entries(assets).map(([url, bytes]) => [source[url], crypto.createHash('sha256').update(bytes).digest('hex')])),
        denied, expectedDenied, unexpected, errors, consoleErrors, expectedConsoleFailures, unexpectedConsoleErrors
      }, null, 2)), contentType: 'application/json' });
      await context.close();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      expect(denied.sort()).toEqual(expectedDenied.sort());
      expect(unexpected).toEqual([]);
      expect(errors).toEqual([]);
      expect(unexpectedConsoleErrors).toEqual([]);
    }
  }
});
export { expect, signupPath, chatPath };
