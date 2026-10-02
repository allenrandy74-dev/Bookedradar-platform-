import fs from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const m = JSON.parse(fs.readFileSync(new URL('./source-manifest.json', import.meta.url)));
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
for (const [path, sha] of Object.entries({ ...m.mainFiles, ...m.reportingFiles })) {
  const edit = m.approvedStyleChanges?.[path];
  if (!edit) assert.equal(git('rev-parse', 'HEAD:' + path), sha, 'preserved Git blob: ' + path);
  else {
    assert.equal(git('rev-parse', m.reporting + ':' + path), sha, 'original reviewed blob');
    const original = execFileSync('git', ['show', m.reporting + ':' + path], { encoding: 'utf8' });
    assert.equal(original.split(edit.before).length, 2, 'exactly one approved style target');
    const actual = execFileSync('git', ['show', 'HEAD:' + path], { encoding: 'utf8' });
    assert.equal(actual, original.replace(edit.before, edit.after), 'only approved foreground delta: ' + path);
  }
}
const integration = m.integration;
assert.equal(git('rev-parse', integration + '^{tree}'), m.integrationTree);
const parents = git('show', '-s', '--format=%P', integration).split(' ');
assert.deepEqual(parents, [m.main, m.reporting], 'combined candidate parents');
const changes = git('diff', '--name-only', m.main, integration).split('\n').filter(Boolean).sort();
assert.deepEqual(changes, Object.keys(m.reportingFiles).sort(), 'only 16 reporting changes over main');
for (const path of git('diff', '--name-only', integration, 'HEAD').split('\n').filter(Boolean))
  assert(path.startsWith('qa/reporting-browser/') || path === '.github/workflows/reporting-browser-qa.yml' || Object.hasOwn(m.approvedStyleChanges || {}, path), 'QA or exact approved style change only: ' + path);
const evidence = { main: m.main, reporting: m.reporting, integration, integrationTree: git('rev-parse', integration + '^{tree}'), head: git('rev-parse', 'HEAD'), headTree: git('rev-parse', 'HEAD^{tree}'), preservedMainFiles: 7, baselineReportingFiles: 16, unchangedReportingFiles: 14, exactApprovedStyleChanges: m.approvedStyleChanges };
fs.mkdirSync('qa/reporting-browser/evidence', { recursive: true });
fs.writeFileSync('qa/reporting-browser/evidence/commits.json', JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
