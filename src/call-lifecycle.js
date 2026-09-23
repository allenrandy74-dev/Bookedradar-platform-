// Track backend-controlled calls, including acceptance before the sideband opens.
// Render defaults to a 30s shutdown deadline; leave 5s for final process cleanup.
export function createCallLifecycle({ log, exit, schedule = setTimeout, cancel = clearTimeout, timeoutMs = 25000 }) {
  const calls = new Set();
  let draining = false, httpClosed = false, finished = false, timer;
  function finish(code) {
    if (finished) return;
    finished = true;
    cancel(timer);
    log(code ? 'server.drain_timeout' : 'server.drain_complete', { active_calls: calls.size });
    exit(code);
  }
  function check() {
    if (draining && httpClosed && calls.size === 0) finish(0);
  }
  return {
    count: () => calls.size,
    isDraining: () => draining,
    begin(id) {
      if (draining || !id || calls.has(id)) return false;
      calls.add(id);
      log('call.control_started', { call_id: id, active_calls: calls.size });
      return true;
    },
    end(id) {
      if (!calls.delete(id)) return;
      log('call.control_ended', { call_id: id, active_calls: calls.size });
      check();
    },
    shutdown(closeHttp) {
      if (draining) return;
      draining = true;
      log('server.draining', { active_calls: calls.size, timeout_ms: timeoutMs });
      timer = schedule(() => finish(1), timeoutMs);
      // Keep the deadline referenced even after HTTP stops accepting connections.
      closeHttp(() => { httpClosed = true; check(); });
    },
  };
}
