import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const manifest=JSON.parse(fs.readFileSync(new URL('./source-manifest.json',import.meta.url)));
for(const file of manifest.files){
  const bytes=fs.readFileSync(root+file.path);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),file.sha256,file.path);
  assert.equal(crypto.createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex'),file.git_blob,file.path);
}
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const changed=git('diff','--name-only',manifest.commit,'HEAD').split('\n').filter(Boolean);
const allowed=['.github/workflows/mobile-browser-qa.yml','qa/mobile-browser/README.md','qa/mobile-browser/mobile.spec.mjs','qa/mobile-browser/playwright.config.mjs','qa/mobile-browser/source-manifest.json','qa/mobile-browser/verify-source.mjs','qa/mobile-browser/package-evidence.py'];
for(const file of changed)assert(allowed.includes(file),'Unapproved file changed: '+file);
const evidence={base:manifest.commit,head:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),files:manifest.files,changed};
fs.mkdirSync(new URL('./evidence/',import.meta.url),{recursive:true});
fs.writeFileSync(new URL('./evidence/source-verification.json',import.meta.url),JSON.stringify(evidence,null,2));
console.log(JSON.stringify(evidence,null,2));
