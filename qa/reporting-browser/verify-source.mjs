import fs from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// source-manifest.json records historical acceptance, not a freeze on future
// product changes. Verify the exact current checkout and record its identities.
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const head = git('rev-parse', 'HEAD');
if (process.env.CI) assert(process.env.QA_COMMIT, 'CI must identify the requested QA commit');
if (process.env.QA_COMMIT) assert.equal(head, process.env.QA_COMMIT, 'requested QA commit');
const inputs = [
  'public/signup.html', 'public/pilot-signup.js', 'public/bookedradar-chat.js',
  'website/src/demo-chat.js', 'website/src/demo-chat.html',
  'public/owner-brief.html', 'public/radarproof-dashboard.html',
  'server.js', 'startup.mjs', 'src', 'test', 'scripts', 'config', 'db', 'package.json', 'package-lock.json',
  'qa/reporting-browser', '.github/workflows/reporting-browser-qa.yml'
];
// Discover expected inputs from the verified commit, never the mutable index.
const paths = git('ls-tree', '-r', '--name-only', '-z', head, '--', ...inputs).split('\0').filter(Boolean);
assert.equal(git('diff', '--cached', '--name-only', head, '--', ...inputs), '', 'index matches commit');
for (const required of ['public/owner-brief.html', 'public/radarproof-dashboard.html',
  'public/signup.html', 'public/pilot-signup.js', 'public/bookedradar-chat.js', 'website/src/demo-chat.js', 'package-lock.json'])
  assert(paths.includes(required), 'required tracked source: ' + required);
const files = {};
for (const path of paths) {
  const parts = path.split('/');
  for (let index = 1; index < parts.length; index++) {
    const parent = parts.slice(0, index).join('/');
    assert(fs.lstatSync(parent).isDirectory(), 'regular source directory: ' + parent);
  }
  assert(fs.lstatSync(path).isFile(), 'regular source file: ' + path);
  const blob = git('rev-parse', 'HEAD:' + path);
  assert.equal(git('hash-object', '--no-filters', '--', path), blob, 'checkout matches commit: ' + path);
  files[path] = blob;
}
const evidence = {
  head, headTree: git('rev-parse', 'HEAD^{tree}'), files,
  scope: 'Current committed reporting inputs; synthetic QA only, not production acceptance'
};
fs.mkdirSync('qa/reporting-browser/evidence', { recursive: true });
fs.writeFileSync('qa/reporting-browser/evidence/commits.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ head, headTree: evidence.headTree, verifiedFiles: paths.length }));
