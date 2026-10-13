import { test, expect, signupPath } from './public-fixture.mjs';

for (const preference of ['email', 'phone']) {
  test(`signup ${preference}: native form, confirmed receipt and success focus`, async ({ page, publicQA: qa }) => {
    await qa.open('signup');
    await qa.fillSignup(preference);
    await page.locator('#submit-request').focus();
    await page.keyboard.press('Enter');
    const request = await qa.request();
    expect(request.path).toBe(signupPath);
    expect(request.body.contactPreference).toBe(preference);
    if (preference === 'email') expect(request.body).not.toHaveProperty('phone');
    else expect(request.body.phone).toBe('+12025550100');
    await expect(page.locator('#submit-request')).toBeDisabled();
    await page.locator('#pilot-request').evaluate(form => form.requestSubmit());
    await page.clock.runFor(100);
    expect(qa.requests).toHaveLength(1);
    request.reply({ ok: true });
    await expect(page.locator('#success')).toBeVisible();
    await expect(page.locator('#success')).toBeFocused();
    await expect(page.locator('#pilot-request')).toBeHidden();
    await expect(page.locator('#confirmation')).toContainText(preference === 'email' ? 'no sales call' : 'asked for a phone call');
  });
}
test('signup duplicate receipt stays distinct from a new request', async ({ page, publicQA: qa }) => {
  await qa.open('signup'); await qa.fillSignup();
  await page.locator('#submit-request').click();
  (await qa.request()).reply({ ok: true, duplicate: true });
  await expect(page.locator('#success h2')).toHaveText('A request is already recorded.');
  await expect(page.locator('#success')).toBeFocused();
});
test('signup native validation blocks missing callback and permits switching back to email', async ({ page, publicQA: qa }) => {
  await qa.open('signup'); await qa.fillSignup();
  await page.locator('#contact-preference').selectOption('phone');
  await page.locator('#submit-request').click();
  await expect(page.locator('#phone')).toBeFocused();
  expect(qa.requests).toHaveLength(0);
  await page.locator('#contact-preference').selectOption('email');
  await expect(page.locator('#phone')).toBeDisabled();
  await page.locator('#submit-request').click();
  const request = await qa.request(); expect(request.body).not.toHaveProperty('phone');
  request.reply({ ok: true }); await expect(page.locator('#success')).toBeVisible();
});
for (const failure of ['stalled response', 'stalled JSON', 'HTTP error', 'invalid JSON', 'network abort']) {
  test(`signup ${failure}: preserve values and block repeated uncertain writes`, async ({ page, publicQA: qa }) => {
    await qa.open('signup'); await qa.fillSignup();
    if (failure === 'network abort') qa.failNextRequest();
    await page.locator('#submit-request').click();
    const request = await qa.request();
    if (failure === 'stalled JSON') {
      const headers = page.waitForResponse(response => response.url() === qa.origin + signupPath);
      request.startJSON();
      await headers;
    }
    if (failure === 'HTTP error') request.reply({ ok: false }, 503);
    if (failure === 'invalid JSON') request.invalid();
    if (failure === 'network abort') {
      await request.fail();
      expect(qa.serverPosts).toBe(0);
    }
    if (failure.startsWith('stalled')) {
      request.expectAbort();
      await page.clock.fastForward(19999);
      await expect(page.locator('#submit-request')).toBeDisabled();
      await expect(page.locator('#status')).toBeEmpty();
      await page.clock.fastForward(2);
    }
    await expect(page.locator('#status')).toContainText('may have been received');
    await expect(page.locator('#status')).toHaveAttribute('aria-live', 'polite');
    await expect(page.locator('#submit-request')).toBeDisabled();
    await expect(page.locator('[name="name"]')).toHaveValue('Synthetic Visitor');
    await expect(page.locator('[name="email"]')).toHaveValue('visitor@example.invalid');
    await expect(page.locator('#success')).toBeHidden();
    await page.locator('[name="email"]').fill('changed@example.invalid');
    await page.keyboard.press('Enter');
    await page.locator('#pilot-request').evaluate(form => form.requestSubmit());
    await page.clock.runFor(100);
    expect(qa.requests).toHaveLength(1);
    await expect(page.locator('#submit-request')).toHaveText('Contact us to confirm');
    if (failure.startsWith('stalled')) {
      if (failure === 'stalled JSON') request.finishJSON({ ok: true });
      else request.reply({ ok: true });
      await page.clock.runFor(100);
      await expect(page.locator('#success')).toBeHidden();
      await expect(page.locator('#submit-request')).toBeDisabled();
      await expect(page.locator('#status')).toContainText('may have been received');
      expect(qa.requests).toHaveLength(1);
    }
  });
}
for (const kind of ['chat', 'demo']) {
  test(`${kind}: accessible shadow-root controls, keyboard dismissal and preserved draft`, async ({ page, publicQA: qa }) => {
    await qa.open(kind);
    const launcher = page.locator('.br-launch');
    await expect(launcher).toHaveAttribute('aria-expanded', 'false');
    await launcher.focus(); await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: kind === 'chat' ? 'How can we help?' : 'HVAC intake demo' });
    await expect(dialog).toBeVisible();
    await expect(launcher).toHaveAttribute('aria-controls', await dialog.getAttribute('id'));
    const input = dialog.getByRole('textbox', { name: 'Message', exact: true });
    await expect(input).toBeFocused();
    await expect(dialog.getByRole('log', { name: 'Chat conversation' })).toHaveAttribute('aria-live', 'polite');
    await input.fill('SYNTHETIC QA draft');
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('log')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: 'Close chat' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden(); await expect(launcher).toBeFocused();
    await expect(launcher).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Enter');
    await expect(input).toHaveValue('SYNTHETIC QA draft');
    await dialog.getByRole('button', { name: 'Close chat' }).click();
    await expect(launcher).toBeFocused(); await expect(dialog).toBeHidden();
    expect(qa.requests).toHaveLength(0);
  });
  for (const outcome of ['success', 'failure']) for (const move of ['dismissed', 'outside focus']) {
    test(`${kind}: late ${outcome} after ${move} preserves user focus and history`, async ({ page, publicQA: qa }) => {
      await qa.open(kind); await page.locator('.br-launch').click();
      const input = page.getByRole('textbox', { name: 'Message', exact: true });
      await input.fill('SYNTHETIC QA hello'); await page.keyboard.press('Enter');
      const request = await qa.request();
      await expect(page.locator('.br-send')).toBeDisabled();
      await input.fill('SYNTHETIC QA draft');
      await page.locator('.br-form').evaluate(form => form.requestSubmit());
      await page.clock.runFor(100);
      expect(qa.requests).toHaveLength(1);
      if (move === 'dismissed') await page.keyboard.press('Escape');
      else await page.locator('#outside').click();
      const focus = page.locator(move === 'dismissed' ? '.br-launch' : '#outside');
      await expect(focus).toBeFocused();
      if (outcome === 'success') request.reply({ ok: true, sessionId: 'qa-session', reply: 'SYNTHETIC QA reply' });
      else request.reply({ ok: false }, 503);
      await expect(page.locator('.br-log')).toContainText(outcome === 'success' ? 'Assistant: SYNTHETIC QA reply' : 'Assistant: I’m sorry');
      await expect(page.locator('.br-send')).toBeEnabled(); await expect(focus).toBeFocused();
      if (move === 'dismissed') {
        await expect(page.locator('.br-panel')).toBeHidden();
        await page.locator('.br-launch').click();
      }
      await expect(page.locator('.br-log')).toContainText('You: SYNTHETIC QA hello');
      await expect(input).toHaveValue('SYNTHETIC QA draft');
      expect(qa.requests).toHaveLength(1);
    });
  }
}
for (const width of [320, 390, 1440]) for (const kind of ['signup', 'chat', 'demo']) {
  test(`${kind}: synthetic geometry and screenshot at ${width}px`, async ({ page, publicQA: qa }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await qa.open(kind);
    if (kind !== 'signup') await page.locator('.br-launch').click();
    const geometry = await page.evaluate(() => {
      const host = document.querySelector('[data-bookedradar-chat]');
      const root = host?.shadowRoot || document;
      const selector = host ? '.br-panel,.br-input,.br-send,.br-close' : '#submit-request,[name="name"],[name="email"]';
      return { width: innerWidth, document: document.documentElement.scrollWidth,
        rects: [...root.querySelectorAll(selector)].map(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width }; }) };
    });
    expect(geometry.rects).toHaveLength(kind === 'signup' ? 3 : 4);
    expect(geometry.document).toBeLessThanOrEqual(geometry.width);
    for (const rect of geometry.rects) {
      expect(rect.width).toBeGreaterThan(0); expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(geometry.width);
    }
    await qa.screenshot(`${kind}-${width}-synthetic`);
  });
}
test('public fixture aborts unapproved network destinations before transport', async ({ page, publicQA: qa }) => {
  await qa.open('signup');
  qa.expectDenied(['GET https://blocked.example.invalid/probe', `POST ${qa.origin}/unapproved`]);
  await page.evaluate(async origin => {
    await Promise.all([
      fetch('https://blocked.example.invalid/probe').catch(() => {}),
      fetch(origin + '/unapproved', { method: 'POST', body: 'synthetic' }).catch(() => {})
    ]);
  }, qa.origin);
  expect(qa.requests).toHaveLength(0);
});
