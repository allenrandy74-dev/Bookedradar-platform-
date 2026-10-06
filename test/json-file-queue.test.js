import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { JsonStateStore } from '../src/state-store.js';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'br-json-queue-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('local lock waiters use canonical FIFO admission without polling or blocking other files', async t => {
  const dir = await fixture(t);
  await fs.mkdir(path.join(dir, 'actual'));
  await fs.symlink(path.join(dir, 'actual'), path.join(dir, 'alias'));
  const p = path.join(dir, 'actual', 'state.json');
  const holder = new JsonStateStore(p);
  const entered = deferred(), release = deferred();
  const active = holder.transaction(async tx => {
    entered.resolve();
    await release.promise;
    await tx.patchCall('discarded', { tenantId: 'synthetic' });
    throw new Error('synthetic transaction failure');
  });
  const rejected = assert.rejects(active, /synthetic transaction failure/);
  await entered.promise;
  let mkdirAttempts = 0, canonicalized;
  const mkdir = fs.mkdir.bind(fs), realpath = fs.realpath.bind(fs);
  t.mock.method(fs, 'mkdir', async (...args) => {
    if (args[0] === `${p}.lock`) mkdirAttempts++;
    return mkdir(...args);
  });
  t.mock.method(fs, 'realpath', async (...args) => {
    const result = await realpath(...args);
    canonicalized?.resolve();
    return result;
  });
  const completed = [], pending = [];
  for (let i = 0; i < 12; i++) {
    canonicalized = deferred();
    const store = new JsonStateStore(path.join(dir, i % 2 ? 'alias' : 'actual', 'state.json'));
    pending.push(store.transaction(async tx => {
      completed.push(i);
      await tx.patchCall(`call-${i}`, { tenantId: 'synthetic' });
    }));
    await canonicalized.promise;
    await setImmediate(); // Drain admission microtasks; no elapsed-time synchronization.
  }
  const attemptsWhileHeld = mkdirAttempts;
  await new JsonStateStore(path.join(dir, 'independent.json')).patchCall('free', { tenantId: 'synthetic' });
  release.resolve();
  await rejected;
  await Promise.all(pending);
  assert.equal(attemptsWhileHeld, 0, 'queued local callers must not poll the filesystem lock');
  assert.equal(mkdirAttempts, 12, 'each admitted caller acquires the filesystem lock exactly once');
  assert.deepEqual(completed, Array.from({ length: 12 }, (_, i) => i));
  assert.equal(await holder.getCall('discarded'), null);
  const data = JSON.parse(await fs.readFile(p, 'utf8'));
  assert.equal(Object.keys(data.calls).length, 12);
});

test('local queue timeout never executes the expired callback or removes the active lock', async t => {
  const dir = await fixture(t), p = path.join(dir, 'state.json');
  const entered = deferred(), release = deferred();
  const holder = new JsonStateStore(p);
  const active = holder.transaction(async tx => {
    entered.resolve();
    await release.promise;
    await tx.patchCall('kept', { tenantId: 'synthetic' });
  });
  await entered.promise;
  let invoked = false;
  try {
    await assert.rejects(new JsonStateStore(p).transaction(() => { invoked = true; }), /json_store_locked/);
    assert.equal(invoked, false);
    assert.ok((await fs.stat(`${p}.lock`)).isDirectory());
  } finally { release.resolve(); await active; }
  await new JsonStateStore(p).patchCall('next', { tenantId: 'synthetic' });
  assert.equal(invoked, false);
  assert.equal((await holder.getCall('kept')).tenantId, 'synthetic');
  assert.equal((await holder.getCall('next')).tenantId, 'synthetic');
  await assert.rejects(fs.stat(`${p}.lock`), { code: 'ENOENT' });
});

for (const failure of ['acquisition', 'commit']) {
  test(`local queue drains after filesystem ${failure} failure`, async t => {
    const dir = await fixture(t), p = path.join(dir, 'state.json');
    const store = new JsonStateStore(p);
    const method = failure === 'acquisition' ? 'mkdir' : 'rename';
    const original = fs[method].bind(fs);
    let injected = false;
    t.mock.method(fs, method, async (...args) => {
      if (!injected && (failure === 'commit' || args[0] === `${p}.lock`)) {
        injected = true;
        throw Object.assign(new Error(`synthetic ${failure} failure`), { code: 'EIO' });
      }
      return original(...args);
    });
    await assert.rejects(store.patchCall('failed', { tenantId: 'synthetic' }), /synthetic .* failure/);
    await new JsonStateStore(p).patchCall('next', { tenantId: 'synthetic' });
    assert.equal(await store.getCall('failed'), null);
    assert.equal((await store.getCall('next')).tenantId, 'synthetic');
    await assert.rejects(fs.stat(`${p}.lock`), { code: 'ENOENT' });
    assert.deepEqual((await fs.readdir(dir)).sort(), ['state.json']);
  });
}
