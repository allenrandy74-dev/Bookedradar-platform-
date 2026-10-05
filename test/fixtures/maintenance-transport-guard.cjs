// Loaded only into disposable startup-test subprocesses, before any ESM loader.
// Listening is allowed; all outbound transports are forbidden, even loopback.
const { appendFileSync } = require("node:fs");
const { join } = require("node:path");
const { syncBuiltinESMExports } = require("node:module");
const deny = () => {
  appendFileSync(join(__dirname, "transport-attempts.txt"), "forbidden_transport_attempt\n");
  throw new Error("forbidden_transport_attempt");
};
const net = require("node:net");
net.connect = net.createConnection = net.Socket.prototype.connect = deny;
const http = require("node:http");
http.request = http.get = deny;
const https = require("node:https");
https.request = https.get = deny;
require("node:tls").connect = deny;
require("node:http2").connect = deny;
require("node:dgram").createSocket = deny;
const dns = require("node:dns");
const dnsPromises = require("node:dns/promises");
for (const api of [dns, dnsPromises]) {
  for (const key of Object.keys(api)) {
    if (/^(lookup|resolve|reverse)/.test(key) && typeof api[key] === "function") api[key] = deny;
  }
}
// Node calls lookup even for a numeric listen address. Resolve only the exact
// maintenance bind locally, without invoking any DNS or network operation.
dns.lookup = (host, options, callback) => {
  if (host !== "0.0.0.0") return deny();
  if (typeof options === "function") { callback = options; options = {}; }
  process.nextTick(() => callback(null, options?.all ? [{ address: host, family: 4 }] : host, 4));
};
globalThis.fetch = deny;
globalThis.WebSocket = deny;
if (process.env.BOOKEDRADAR_MAINTENANCE_MODE === "true") {
  const originalTimeout = globalThis.setTimeout;
  const timerAttempt = (kind, delay) => appendFileSync(join(__dirname, "timer-attempts.txt"),
    JSON.stringify({ kind, delay }) + "\n");
  globalThis.setInterval = (_callback, delay) => {
    timerAttempt("setInterval", delay);
    throw new Error("forbidden_maintenance_interval");
  };
  globalThis.setTimeout = (callback, delay, ...args) => {
    timerAttempt("setTimeout", delay);
    if (delay !== 1_000) throw new Error("forbidden_maintenance_timeout");
    return originalTimeout(callback, delay, ...args);
  };
}
syncBuiltinESMExports();
