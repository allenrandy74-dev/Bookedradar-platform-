import { test, expect } from './fixture.mjs';
for (const kind of ['owner', 'radar']) for (const width of [320, 375, 390, 1440]) {
  test(kind + ': layout and keyboard at ' + width + ' CSS px', async ({ qa }, info) => {
    await qa.page.setViewportSize({ width, height: 1000 });
    await qa.open(kind); await qa.loaded(kind);
    const contrast = await qa.page.locator(kind === 'owner' ? '#load' : '#saveToken').evaluate(el => {
      const style = getComputedStyle(el);
      const rgb = color => color.match(/[0-9.]+/g).slice(0, 3).map(Number);
      const luminance = color => rgb(color).map(channel => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
      const text = luminance(style.color), background = luminance(style.backgroundColor);
      return { foreground: style.color, background: style.backgroundColor,
        ratio: (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05) };
    });
    await info.attach('button-contrast', { body: Buffer.from(JSON.stringify(contrast, null, 2)), contentType: 'application/json' });
    console.log('BUTTON_CONTRAST', JSON.stringify({ kind, width, ...contrast }));
    expect(contrast.ratio, 'normal-size button labels require at least 4.5:1').toBeGreaterThanOrEqual(4.5);
    await qa.screenshot(kind + '-' + width + '-success');
    // Geometric checks supplement, rather than replace, human pixel review.
    const issues = await qa.page.evaluate(() => {
      const issues = [], width = innerWidth;
      if (document.documentElement.scrollWidth > width + 1) issues.push('document horizontal overflow');
      const nodes = [...document.querySelectorAll('.card, .source, .item, input, button, a, .title, #status, #coverage, #disclaimer')];
      for (const el of nodes) {
        const r = el.getBoundingClientRect();
        if (r.left < -1 || r.right > width + 1) issues.push('outside viewport: ' + (el.id || el.className || el.tagName));
        if (el.scrollWidth > el.clientWidth + 1 && !['INPUT'].includes(el.tagName)) issues.push('content overflow: ' + (el.id || el.className || el.tagName));
      }
      const boxes = [...document.querySelectorAll('.card')].map(el => el.getBoundingClientRect());
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++)
        if (Math.min(boxes[i].right, boxes[j].right) - Math.max(boxes[i].left, boxes[j].left) > 1 &&
            Math.min(boxes[i].bottom, boxes[j].bottom) - Math.max(boxes[i].top, boxes[j].top) > 1) issues.push('cards overlap');
      return issues;
    });
    await info.attach('geometry', { body: Buffer.from(JSON.stringify(issues)), contentType: 'application/json' });
    // Tab every interactive element in DOM order. Do not activate navigation links.
    const expected = await qa.page.locator('a, input, button').evaluateAll(nodes => nodes.map(el => el.id || el.getAttribute('href')));
    const seen = [];
    for (const key of expected) {
      await qa.page.keyboard.press('Tab');
      const focus = await qa.page.evaluate(() => {
        const el = document.activeElement, style = getComputedStyle(el);
        return { key: el.id || el.getAttribute('href'), visible: el.matches(':focus-visible'),
          indicator: (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== 'none' };
      });
      seen.push(focus.key);
      expect(focus.visible, 'keyboard focus visible: ' + key).toBe(true);
      expect(focus.indicator, 'focus indicator: ' + key).toBe(true);
    }
    expect(seen).toEqual(expected);
    await qa.screenshot(kind + '-' + width + '-keyboard-focus');
    expect(issues, 'geometry issues are reported without changing source').toEqual([]);
  });
}
