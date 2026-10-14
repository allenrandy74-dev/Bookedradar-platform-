import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const verifier = fileURLToPath(new URL('./verify-source.mjs', import.meta.url));
function fixture(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'reporting-provenance-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git('init', '-q');
  for (const file of ['public/owner-brief.html', 'public/radarproof-dashboard.html', 'package-lock.json', 'src/example.js', 'public/signup.html', 'public/pilot-signup.js', 'public/bookedradar-chat.js', 'website/src/demo-chat.js']) {
    fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    fs.writeFileSync(path.join(cwd, file), 'synthetic fixture\n');
  }
  const commit = () => { git('add', '.'); git('-c', 'user.name=Synthetic QA', '-c', 'user.email=qa@example.invalid', 'commit', '-qm', 'Synthetic source'); return git('rev-parse', 'HEAD'); };
  const head = commit();
  const run = (sha = head) => spawnSync(process.execPath, [verifier], { cwd, encoding: 'utf8', env: { ...process.env, CI: 'true', QA_COMMIT: sha } });
  return { cwd, git, commit, head, run };
}
test('records current source identities and accepts later committed product changes', t => {
  const f = fixture(t);
  fs.appendFileSync(path.join(f.cwd, 'public/owner-brief.html'), 'a reviewed future change\n');
  const head = f.commit();
  const result = f.run(head);
  assert.equal(result.status, 0, result.stderr);
  const evidence = JSON.parse(fs.readFileSync(path.join(f.cwd, 'qa/reporting-browser/evidence/commits.json')));
  assert.equal(evidence.head, head);
  assert.equal(evidence.files['public/owner-brief.html'], f.git('rev-parse', 'HEAD:public/owner-brief.html'));
});
test('rejects an unexpected checked-out commit', t => {
  const f = fixture(t);
  const result = f.run('0'.repeat(40));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requested QA commit/);
});
test('rejects modified working source', t => {
  const f = fixture(t);
  fs.appendFileSync(path.join(f.cwd, 'public/owner-brief.html'), 'uncommitted\n');
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /checkout matches commit/);
});
test('rejects missing required source', t => {
  const f = fixture(t);
  f.git('rm', 'public/radarproof-dashboard.html');
  const head = f.commit();
  const result = f.run(head);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /required tracked source/);
});
test('rejects symlinked source', t => {
  const f = fixture(t);
  const file = path.join(f.cwd, 'public/owner-brief.html');
  fs.unlinkSync(file);
  fs.symlinkSync('radarproof-dashboard.html', file);
  const head = f.commit();
  const result = f.run(head);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /regular source file/);
});
test('requires expected commit identity in CI', t => {
  const f = fixture(t);
  const result = f.run('');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CI must identify/);
});

test('rejects staged deletion of a HEAD-tracked backend input', t => {
  const f = fixture(t);
  f.git('rm', 'src/example.js');
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /index matches commit/);
});
test('rejects index removal even when changed working bytes remain', t => {
  const f = fixture(t);
  f.git('rm', '--cached', 'src/example.js');
  fs.writeFileSync(path.join(f.cwd, 'src/example.js'), 'different working source\n');
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /index matches commit/);
});
test('rejects staged content changes even when working bytes match HEAD', t => {
  const f = fixture(t);
  const file = path.join(f.cwd, 'src/example.js');
  fs.writeFileSync(file, 'different staged source\n');
  f.git('add', 'src/example.js');
  fs.writeFileSync(file, 'synthetic fixture\n');
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /index matches commit/);
});
test('rejects a symlinked parent directory with identical source bytes', t => {
  const f = fixture(t);
  fs.renameSync(path.join(f.cwd, 'public'), path.join(f.cwd, 'public-copy'));
  fs.symlinkSync('public-copy', path.join(f.cwd, 'public'));
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /regular source directory/);
});
