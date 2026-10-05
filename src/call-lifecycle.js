// Process-owned call control and explicitly registered work only. External SIP /
// transferred call legs and other instances need independent provider evidence.
// Keep the existing 25s application deadline; platform grace is a separate gate.
export function createCallLifecycle({ log, exit, finalize = null, identity = {},
  schedule = setTimeout, cancel = clearTimeout, timeoutMs = 25000 }) {
  const calls = new Set();
  const work = new Map();
  let draining = false, httpClosed = false, finished = false, closing = false, cleanupDone = false;
  let failedWork = 0, timer;
  const safeLabel = value => /^[a-z][a-z0-9_.-]{0,63}$/.test(value) ? value : 'owned_work';
  const metadata = Object.fromEntries(['instance_id', 'deploy_id', 'commit_id', 'boot_id']
    .filter(key => /^[a-zA-Z0-9_.-]{1,128}$/.test(identity[key] || ''))
    .map(key => [key, identity[key]]));
  const snapshot = () => ({ ...metadata, active_calls: calls.size, pending_work: work.size,
    work_by_kind: Object.fromEntries([...new Set(work.values())].sort().map(kind =>
      [kind, [...work.values()].filter(value => value === kind).length])),
    failed_work: failedWork, failure_scope: 'process_lifetime',
    owned_work_settled: calls.size === 0 && work.size === 0,
    cleanup_complete: finalize ? cleanupDone : true, http_closed: httpClosed, draining,
    cleanup_started: closing, scope: 'process_owned_work', external_call_legs: 'not_tracked' });
  function finish(code, event) {
    if (finished) return;
    finished = true;
    cancel(timer);
    log(event, { ...snapshot(), complete: code === 0 });
    // The hard-deadline path must not await resource cleanup a second time.
    exit(code);
  }
  function fail(kind) {
    failedWork++;
    log('server.owned_work_failed', { ...metadata, kind: safeLabel(kind), failed_work: failedWork });
  }
  function check() {
    if (!draining || finished || !httpClosed || calls.size || work.size) return;
    if (closing) {
      if (cleanupDone) finish(failedWork ? 1 : 0, failedWork ? 'server.drain_failed' : 'server.drain_complete');
      return;
    }
    if (!finalize) return finish(failedWork ? 1 : 0, failedWork ? 'server.drain_failed' : 'server.drain_complete');
    closing = true;
    // Leave the deadline referenced while pool/resource close is outstanding.
    Promise.resolve().then(finalize).then(() => {
      cleanupDone = true;
      check();
    }, () => { fail('resource_cleanup'); finish(1, 'server.drain_failed'); });
  }
  function track(kind, operation) {
    if (closing && !finished) fail('late_work_during_cleanup');
    const token = Symbol();
    work.set(token, safeLabel(kind));
    let result;
    try { result = typeof operation === 'function' ? operation() : operation; }
    catch (error) { fail(kind); work.delete(token); check(); throw error; }
    if (result && typeof result.then === 'function') {
      Promise.resolve(result).then(() => { work.delete(token); check(); }, () => {
        fail(kind); work.delete(token); check();
      });
    } else { work.delete(token); check(); }
    return result;
  }
  return {
    count: () => calls.size,
    isDraining: () => draining,
    snapshot,
    track,
    fail,
    begin(id) {
      if (draining || !id || calls.has(id)) return false;
      calls.add(id);
      log('call.control_started', { ...metadata, call_id: id, active_calls: calls.size });
      return true;
    },
    end(id) {
      if (!calls.delete(id)) return;
      log('call.control_ended', { ...metadata, call_id: id, active_calls: calls.size });
      check();
    },
    shutdown(closeHttp, stopProducers = () => {}) {
      if (draining) return;
      draining = true;
      log('server.draining', { ...snapshot(), timeout_ms: timeoutMs });
      timer = schedule(() => finish(1, 'server.drain_timeout'), timeoutMs);
      try { stopProducers(); } catch { fail('stop_producers'); }
      try {
        closeHttp(error => { if (error) fail('http_close'); httpClosed = true; check(); });
      } catch { fail('http_close'); /* No proof of closure: wait for the deadline. */ }
    },
  };
}
