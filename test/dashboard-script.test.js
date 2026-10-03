import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { extractFixtureScript } from './fixtures/dashboard-script.js';

for (const [opening, closing] of [
  ['<script>', '</script>'],
  ['<SCRIPT>', '</SCRIPT>'],
  ['<ScRiPt>', '</sCrIpT>'],
]) {
  test(`repository fixture extraction supports ${opening} without changing source text`, () => {
    const script = '\nconst MixedCase = "İß🙂";\n';
    assert.equal(extractFixtureScript(`<!doctype html>İ🙂${opening}${script}${closing}`), script);
  });
}

test('repository fixture extraction rejects missing, reversed or repeated plain script delimiters', () => {
  for (const html of [
    '<html></html>', '<script>unfinished', 'missing</script>',
    '</script><script>reversed', '<script>a</script><SCRIPT>b</SCRIPT>',
    '<script><script>nested</script>', '<script>a</script></SCRIPT>',
    '<script type="module">outside this fixture contract</script>',
  ]) assert.throws(() => extractFixtureScript(html), /Expected one plain inline script/);
});

for (const page of ['owner-brief', 'radarproof-dashboard']) {
  test(`${page} real repository script is identical with uppercase and mixed-case fixture tags`, async () => {
    const html = await fs.readFile(new URL(`../public/${page}.html`, import.meta.url), 'utf8');
    const expected = extractFixtureScript(html);
    for (const [opening, closing] of [['<SCRIPT>', '</SCRIPT>'], ['<ScRiPt>', '</sCrIpT>']]) {
      const variant = html.replaceAll('<script>', opening).replaceAll('</script>', closing);
      assert.equal(extractFixtureScript(variant), expected);
    }
  });
}
