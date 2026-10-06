// Explicit route-registration adapter, not an Express monkeypatch. A response's
// finish/close event is not proof that its asynchronous handler has settled.
export function trackedHandler(handler, track, kind = 'http_handler') {
  if (typeof handler !== 'function') throw new TypeError('route_handler_required');
  if (handler.length === 4) return function (error, req, res, next) {
    return track(kind, () => handler.call(this, error, req, res, next));
  };
  return function (req, res, next) {
    return track(kind, () => handler.call(this, req, res, next));
  };
}
export function trackedRoutes(router, track = (_kind, run) => run()) {
  const wrap = value => Array.isArray(value) ? value.map(wrap) : trackedHandler(value, track);
  return Object.fromEntries(['get', 'post', 'put', 'patch', 'delete'].map(method =>
    [method, (path, ...handlers) => router[method](path, ...handlers.map(wrap))]));
}
