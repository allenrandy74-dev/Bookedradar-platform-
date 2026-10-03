import { test, expect, definitions, payload } from './fixture.mjs';

for (const kind of Object.keys(definitions)) {
  const d = definitions[kind];
  test(kind + ': pending refresh clears all old metrics, details and coverage immediately', async ({ qa }) => {
    await qa.open(kind); await qa.loaded(kind);
    await qa.refresh(kind); await qa.request(1); await qa.cleared(kind);
    await expect(qa.page.locator('#status')).toHaveText('Loading…');
    await qa.screenshot(kind + '-pending');
    await qa.loaded(kind, 1, 0); await expect(qa.page.locator(d.money)).toHaveText('$0');
  });
  for (const mode of ['http', 'network', 'json']) {
    test(kind + ': ' + mode + ' failure after success clears old results and recovers', async ({ qa }) => {
      await qa.open(kind); await qa.loaded(kind);
      if (mode === 'network') qa.failNextRequest();
      await qa.refresh(kind); const req = await qa.request(1); await qa.cleared(kind);
      if (mode === 'http') req.reply({}, 503);
      if (mode === 'network') await req.fail();
      if (mode === 'json') req.invalid();
      await expect(qa.page.locator('#status')).toHaveText(kind === 'owner' ? 'Unavailable' : 'Data unavailable');
      await qa.cleared(kind); await qa.screenshot(kind + '-' + mode + '-failure');
      await qa.refresh(kind); await qa.loaded(kind, 2, 222);
      await expect(qa.page.locator(d.money)).toHaveText('$222');
    });
  }
  for (const oldResult of ['success', 'failure', 'delayed-json']) {
    test(kind + ': overlapping refresh rejects old ' + oldResult, async ({ qa }) => {
      await qa.open(kind); const older = await qa.request(0);
      if (oldResult === 'delayed-json') {
        const headers = qa.page.waitForResponse(r => r.url().includes(d.endpoint));
        older.startJSON(); await headers;
      }
      await qa.refresh(kind); await qa.loaded(kind, 1, 222);
      // Record every subsequent money mutation, not only the final state.
      await qa.page.evaluate(selector => {
        window.qaMoneyHistory = [];
        new MutationObserver(() => window.qaMoneyHistory.push(document.querySelector(selector).textContent))
          .observe(document.querySelector(selector), { childList: true, subtree: true, characterData: true });
      }, d.money);
      const finished = oldResult === 'failure'
        ? qa.page.waitForResponse(r => r.url().includes(d.endpoint) && r.status() === 503)
        : qa.page.waitForEvent('requestfinished', { predicate: r => r.url().includes(d.endpoint) });
      if (oldResult === 'success') older.reply(payload(kind, 111));
      if (oldResult === 'failure') older.reply({}, 503);
      if (oldResult === 'delayed-json') older.finishJSON(payload(kind, 111));
      await finished; await qa.settle();
      await expect(qa.page.locator(d.money)).toHaveText('$222');
      await expect(qa.page.locator('#status')).toHaveText('Live');
      expect(await qa.page.evaluate(() => window.qaMoneyHistory)).not.toContain('$111');
    });
  }
  test(kind + ': token edit invalidates an outstanding response; failed switch never revives old values', async ({ qa }) => {
    await qa.open(kind); await qa.loaded(kind);
    await qa.refresh(kind); const old = await qa.request(1);
    await qa.page.locator('#token').fill('qa-token-b'); await qa.cleared(kind);
    await expect(qa.page.locator('#status')).toHaveText('Refresh required');
    const finished = qa.page.waitForEvent('requestfinished', { predicate: r => r.url().includes(d.endpoint) });
    old.reply(payload(kind, 111)); await finished; await qa.settle(); await qa.cleared(kind);
    await qa.refresh(kind); const next = await qa.request(2);
    expect(next.authorization).toBe('Bearer qa-token-b'); next.reply({}, 401);
    await expect(qa.page.locator('#status')).toHaveText(kind === 'owner' ? 'Unavailable' : 'Data unavailable');
    await qa.cleared(kind);
    await qa.refresh(kind); await qa.loaded(kind, 3, 222);
    await expect(qa.page.locator(d.money)).toHaveText('$222');
  });
  test(kind + ': zero, unavailable, estimates, recovery and evidence wording stay distinct', async ({ qa }) => {
    await qa.open(kind);
    await qa.loaded(kind, 0, 0);
    await expect(qa.page.locator(d.money)).toHaveText('$0');
    await expect(qa.page.locator('#recovered')).toHaveText('2');
    await expect(qa.page.getByText('Transfers initiated', { exact: true })).toBeVisible();
    await expect(qa.page.getByText('Transfers initiated does not establish a completed human connection.')).toBeVisible();
    await expect(qa.page.locator('#coverage')).toContainText('unmarked history is unverified');
    await expect(qa.page.locator('#coverage')).toContainText('may omit genuine activity');
    await expect(qa.page.locator(kind === 'owner' ? '#risk' : '#estimated')).toHaveText(kind === 'owner' ? '$600' : '$500');
    if (kind === 'radar') await expect(qa.page.locator('#rate')).toHaveText('50%');
    await qa.refresh(kind);
    await qa.loaded(kind, 1, null, { recoveryRate: null });
    await expect(qa.page.locator(d.money)).toHaveText('Unavailable');
    if (kind === 'radar') await expect(qa.page.locator('#rate')).toHaveText('Unavailable');
    await qa.screenshot(kind + '-unavailable-revenue');
  });
}

test('Owner Brief: tenant editing plus failed switch rejects old tenant response', async ({ qa }) => {
  await qa.open('owner'); await qa.loaded('owner');
  await qa.refresh('owner'); const old = await qa.request(1);
  await qa.page.locator('#tenant').fill('qa-b'); await qa.cleared('owner');
  await qa.refresh('owner'); const next = await qa.request(2);
  expect(next.url).toBe('/api/v1/owner-brief?tenant=qa-b'); next.reply({}, 403);
  await expect(qa.page.locator('#status')).toHaveText('Unavailable');
  const finished = qa.page.waitForEvent('requestfinished', { predicate: r => r.url().includes('tenant=qa-a') });
  old.reply(payload('owner', 111)); await finished; await qa.settle(); await qa.cleared('owner');
  await qa.refresh('owner'); await qa.loaded('owner', 3, 222);
  await expect(qa.page.locator('#tenant')).toHaveValue('qa-b');
  await expect(qa.page.locator('#revenue')).toHaveText('$222');
});

test('RadarProof: tenant URL navigation cannot retain previous tenant amounts', async ({ qa }) => {
  await qa.open('radar'); await qa.loaded('radar');
  await qa.refresh('radar'); const old = await qa.request(1);
  await qa.open('radar', 'qa-b'); const next = await qa.request(2);
  expect(next.url).toBe('/api/v1/radarproof?tenant=qa-b');
  await qa.cleared('radar'); next.reply({}, 403);
  await expect(qa.page.locator('#status')).toHaveText('Data unavailable');
  old.reply(payload('radar', 111)); await qa.settle(); await qa.cleared('radar');
  await qa.refresh('radar'); await qa.loaded('radar', 3, 222);
  await expect(qa.page.locator('#confirmed')).toHaveText('$222');
});

test('RadarProof: actual 30-second interval during unsaved token editing makes no request', async ({ qa }) => {
  await qa.open('radar'); await qa.loaded('radar');
  await qa.page.locator('#token').fill('qa-token-b'); await qa.cleared('radar');
  await qa.page.clock.fastForward(30001);
  await qa.settle();
  expect(qa.requests).toHaveLength(1);
  await expect(qa.page.locator('#status')).toHaveText('Refresh required'); await qa.cleared('radar');
  await qa.screenshot('radar-unsaved-token-after-30-seconds');
  await qa.refresh('radar'); expect((await qa.request(1)).authorization).toBe('Bearer qa-token-b');
  await qa.loaded('radar', 1, 222);
  await qa.page.clock.fastForward(30001); await qa.request(2); await qa.cleared('radar');
  await qa.loaded('radar', 2, 333); await expect(qa.page.locator('#confirmed')).toHaveText('$333');
});

test('isolation: external fetch, websocket and same-origin submission are denied before server contact', async ({ qa }) => {
  await qa.open('owner'); await qa.loaded('owner');
  const external = 'https://blocked-qa.invalid/probe';
  const socket = 'wss://blocked-qa.invalid/socket';
  qa.expectDenied(['GET ' + external, 'POST ' + qa.origin + '/api/v1/owner-brief?tenant=qa-a', 'WS ' + socket]);
  const results = await qa.page.evaluate(async ({ external, socket }) => {
    const fetches = await Promise.all([
      fetch(external).then(() => 'escaped', () => 'blocked'),
      fetch('/api/v1/owner-brief?tenant=qa-a', { method: 'POST', body: 'synthetic probe' }).then(() => 'escaped', () => 'blocked')
    ]);
    await new Promise(resolve => { const ws = new WebSocket(socket); ws.onclose = resolve; ws.onerror = resolve; });
    return fetches;
  }, { external, socket });
  expect(results).toEqual(['blocked', 'blocked']);
  expect(qa.requests).toHaveLength(1);
});
