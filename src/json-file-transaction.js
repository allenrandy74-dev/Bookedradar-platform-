import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const active = Symbol('jsonTransaction');
const dirty = Symbol('jsonDirty');
const baseline = Symbol('jsonBaseline');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const localLocks = new Map();
const lockUnavailable = () => new Error('json_store_locked: exclusive lock unavailable; operator recovery required if owner crashed');

// FIFO admission avoids an in-process mkdir polling herd. This is only an
// optimization: the filesystem lock remains authoritative across processes.
// The original five-second acquisition budget includes time in this queue.
function localLock(key, deadline) {
  let queue = localLocks.get(key);
  if (!queue) { queue = []; localLocks.set(key, queue); }
  return new Promise((resolve, reject) => {
    const entry = { admit: null, timer: null };
    entry.admit = () => {
      clearTimeout(entry.timer);
      resolve(() => {
        queue.shift();
        if (queue.length) queue[0].admit();
        else localLocks.delete(key);
      });
    };
    queue.push(entry);
    if (queue.length === 1) entry.admit();
    else entry.timer = setTimeout(() => {
      queue.splice(queue.indexOf(entry), 1);
      reject(lockUnavailable());
    }, Math.max(0, deadline - Date.now()));
  });
}
function dictionaryPrototypes(data) {
  for (const [key, value] of Object.entries(data)) {
    if (key === 'eventKeyFormat') { if (value !== 'tenant_scoped_v1') throw new Error('json_event_key_format_unsupported'); continue; }
    if (key === 'events') { if (!Array.isArray(value)) throw new Error('json_store_invalid_shape'); continue; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('json_store_invalid_shape');
    Object.setPrototypeOf(value, null);
  }
}

// Cooperative local-filesystem protocol. Every writer must use this lock.
// A crashed lock holder deliberately requires operator recovery: age/PID alone
// cannot prove a lock is abandoned safely. Network filesystems are unsupported.
async function locked(filePath, callback) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const canonicalPath = path.join(await fs.realpath(path.dirname(filePath)), path.basename(filePath));
  const lock = `${canonicalPath}.lock`;
  const deadline = Date.now() + 5000;
  const releaseLocal = await localLock(canonicalPath, deadline);
  try {
    while (true) {
      if (Date.now() >= deadline) throw lockUnavailable();
      try { await fs.mkdir(lock); break; }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (Date.now() >= deadline) throw lockUnavailable();
        await pause(10);
      }
    }
    try {
      try {
        const stat = await fs.lstat(canonicalPath);
        if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('json_store_unsupported_file_type');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      return await callback(canonicalPath);
    }
    finally { await fs.rmdir(lock); }
  } finally { releaseLocal(); }
}

async function commit(filePath, data) {
  const tmp = `${filePath}.${crypto.randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(tmp, 'wx', 0o600);
    await handle.writeFile(JSON.stringify(data, null, 2), 'utf8');
    await handle.sync();
    await handle.close(); handle = null;
    await fs.rename(tmp, filePath);
    const directory = await fs.open(path.dirname(filePath), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally {
    if (handle) await handle.close();
    await fs.unlink(tmp).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

export function immutableOwnership(prior, patch, fields = ['tenantId', 'id']) {
  if (!prior) return;
  for (const key of fields) {
    if (Object.hasOwn(patch, key) && prior[key] !== undefined && patch[key] !== prior[key]) {
      throw new Error(`immutable_${key}: existing record ownership/identity cannot change`);
    }
  }
}

// Existing store implementations become transactional without sharing mutable
// per-instance state across overlapping calls. Public methods join a supplied
// transaction view; their persist calls only mark the one outer commit dirty.
export function transactionalJsonStore(Store, field) {
  const originalLoad = Store.prototype.load;

  const methods = Object.getOwnPropertyNames(Store.prototype)
    .filter(name => !['constructor', 'load', 'loadWithoutPrune', 'persist'].includes(name));
  Store.prototype.transaction = async function(callback) {
    if (this[active]) return callback(this);
    return locked(this.filePath, async canonicalPath => {
      const view = Object.create(this);
      view.filePath = canonicalPath;
      view[active] = true; view[dirty] = false; view.loaded = false;
      view[field] = structuredClone(this[field]);
      // Reset absent-file data as well as reloading existing files.
      for (const key of Object.keys(view[field])) { if (key === 'eventKeyFormat') continue; view[field][key] = Array.isArray(view[field][key]) ? [] : {}; }
      await originalLoad.call(view);
      dictionaryPrototypes(view[field]);
      const result = await callback(view);
      if (view[dirty]) await commit(canonicalPath, view[field]);
      this[field] = structuredClone(view[field]); this.loaded = true;
      this[baseline] = JSON.stringify(view[field]);
      return structuredClone(result);
    });
  };
  for (const name of methods) {
    const original = Store.prototype[name];
    Store.prototype[name] = async function(...args) {
      if (this[active]) return original.apply(this, args);
      return this.transaction(view => original.apply(view, args));
    };
  }
  Store.prototype.load = async function() {
    if (this[active]) return originalLoad.call(this);
    return this.transaction(() => undefined);
  };
  Store.prototype.persist = async function() {
    if (this[active]) { this[dirty] = true; return; }
    // Legacy explicit snapshot edits can only persist with compare-and-swap.
    // Missing baseline is never permission to overwrite another writer.
    const desired = structuredClone(this[field]);
    const expected = this[baseline];
    return this.transaction(async view => {
      if (expected === undefined || JSON.stringify(view[field]) !== expected) throw new Error('json_store_stale_snapshot');
      view[field] = desired; view[dirty] = true;
    });
  };
}

// For database adapters that already own a database transaction, and explicit
// synthetic in-memory fixtures only. Never use for a file-backed store.
export function useJsonMemoryView(store) {
  store[active] = true;
  store.loaded = true;
  if (store.data) dictionaryPrototypes(store.data);
  if (store.state) dictionaryPrototypes(store.state);
  return store;
}
