import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFile, copyFile, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, connect } from "node:net";
import { request } from "node:http";

const source = new URL("../startup.mjs", import.meta.url);
const importGuard = new URL("./fixtures/maintenance-import-guard.mjs", import.meta.url);
const transportGuard = new URL("./fixtures/maintenance-transport-guard.cjs", import.meta.url);
const serviceId = "srv-dam8f7bm8hqs73ct778g";
const databaseUrl = "postgresql://synthetic:synthetic-secret@dpg-date5bk9v7es738c22pg-a/bookedradar_postgres_production";
const originalSettings = {
  VOICE_ENABLED: "true", DISPATCH_ENABLED: "false", OPS_ALERTS_ENABLED: "true",
  BOOKEDRADAR_BILLING_ENABLED: "true", BOOKEDRADAR_BILLING_LIVE_ARMED: "false",
  WARM_TRANSFER_ENABLED: "false", DEMO_NUMBER_PROVISION_MODE: "off",
  POSTGRES_PRODUCTION_ARMED: "true", POSTGRES_STATELESS_MODE: "true",
  POSTGRES_HEALTH_ON_STARTUP: "true", POSTGRES_SHADOW_IMPORT_ON_STARTUP: "false",
  POSTGRES_JSON_ROLLBACK_ON_STARTUP: "false", POSTGRES_MIGRATION_AUDIT_ON_STARTUP: "false",
  POSTGRES_RESTORE_DRILL_ON_STARTUP: "false", POSTGRES_MIGRATION_DIFF_ON_STARTUP: "false",
  HTTP_TIMEOUT_MS: "8000", MAX_HTTP_RETRIES: "3", TWILIO_TRANSFER_SMS_FROM: "+15555550101",
  TWILIO_VOICE_CALLER_ID: "+15555550102", WARM_TRANSFER_SIP_DOMAIN: "synthetic.invalid",
  OPENAI_API_KEY: "synthetic-provider-key", TWILIO_AUTH_TOKEN: "synthetic-provider-secret",
};

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "maintenance-startup-"));
  await copyFile(source, path.join(directory, "startup.mjs"));
  await copyFile(importGuard, path.join(directory, "guard.mjs"));
  await copyFile(transportGuard, path.join(directory, "transport.cjs"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

function launch(t, directory, overrides = {}, args = []) {
  // Never inherit developer/provider credentials from the test runner.
  const env = {
    NODE_NO_WARNINGS: "1", NODE_ENV: "production",
    RENDER_SERVICE_ID: serviceId, RENDER_SERVICE_NAME: "bookedradar-platform",
    BOOKEDRADAR_MAINTENANCE_MODE: "true", BOOKEDRADAR_MAINTENANCE_SERVICE_ID: serviceId,
    BOOKEDRADAR_STORAGE_BACKEND: "postgres", DATABASE_URL: databaseUrl,
    ...originalSettings, ...overrides,
  };
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
  const child = spawn(process.execPath, ["--require", "./transport.cjs", "--experimental-loader", "./guard.mjs", "startup.mjs", ...args], {
    cwd: directory, env, stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  const finished = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  const deadline = setTimeout(() => child.kill("SIGKILL"), 15_000);
  deadline.unref();
  finished.then(() => clearTimeout(deadline), () => clearTimeout(deadline));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await finished;
  });
  const ready = () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => settle(new Error("maintenance_startup_timeout")), 10_000);
    const check = () => { if (stdout.includes('"event":"maintenance.listening"')) settle(); };
    function settle(error) {
      clearTimeout(timer);
      child.stdout.off("data", check);
      error ? reject(error) : resolve();
    }
    child.stdout.on("data", check);
    finished.then(result => settle(new Error(`maintenance_exited_before_ready: ${result.stderr}`)), settle);
    check();
  });
  return { child, env, finished, ready, output: () => ({ stdout, stderr }) };
}

async function imports(directory) {
  return (await readFile(path.join(directory, "imports.txt"), "utf8")).trim().split("\n");
}

async function assertNoApplicationImports(list, directory) {
  const entry = new URL(`file://${path.join(directory, "startup.mjs")}`).href;
  assert.deepEqual(list, [entry, "node:http", "node:crypto"]);
  assert.ok(!(await readdir(directory)).includes("transport-attempts.txt"), "startup attempted an outbound transport");
}

function http(port, method, route, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path: route, headers, agent: false }, response => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { text += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, text }));
      response.on("error", reject);
    });
    req.setTimeout(5_000, () => req.destroy(new Error("test_request_timeout")));
    req.on("error", reject);
    req.end(body);
  });
}

function raw(port, input) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port }, () => socket.write(input));
    let output = "";
    socket.setEncoding("utf8");
    socket.setTimeout(5_000, () => socket.destroy(new Error("test_socket_timeout")));
    socket.on("data", chunk => { output += chunk; });
    socket.once("end", () => resolve(output));
    socket.once("error", reject);
  });
}

test("maintenance starts without application files/dependencies and exposes only labeled liveness", async t => {
  const directory = await fixture(t);
  const port = await availablePort();
  // Host/database are pinned, credentials are invented, and no app files,
  // config, stores, schema, package.json or node_modules exist in the fixture.
  const app = launch(t, directory, { PORT: String(port) });
  await app.ready();
  const health = await http(port, "GET", "/health");
  assert.equal(health.status, 200);
  assert.equal(health.headers["cache-control"], "no-store");
  assert.deepEqual(JSON.parse(health.text), {
    status: "maintenance", mode: "maintenance", customerReady: false, acceptingWork: false,
  });
  assert.equal((await http(port, "HEAD", "/health")).text, "");
  await assertNoApplicationImports(await imports(directory), directory);
  assert.deepEqual((await readdir(directory)).sort(), ["guard.mjs", "imports.txt", "startup.mjs", "transport.cjs"]);
  assert.doesNotMatch(JSON.stringify(app.output()) + health.text, /synthetic-secret|synthetic-provider|postgresql:|dpg-/);
});

test("all customer/admin/webhook paths reject work with 503, including methods and ambiguous health URLs", async t => {
  const directory = await fixture(t);
  const port = await availablePort();
  const app = launch(t, directory, { PORT: String(port) });
  await app.ready();
  const paths = ["/", "/ready", "/health?ready=true", "/health/", "/%68ealth", "/admin", "/voice/transfer/entry",
    "/webhooks/openai", "/webhooks/twilio", "/webhooks/stripe", "/webhooks/sms", "/api/leads", "/chat", "/unknown"];
  for (const route of paths) {
    for (const method of ["GET", "POST", "PUT", "OPTIONS"]) {
      const response = await http(port, method, route, { "Content-Type": "application/json" }, '{"private":"discard-me"}');
      assert.equal(response.status, 503, `${method} ${route}`);
      assert.equal(response.headers["retry-after"], "60");
      assert.equal(response.headers["cache-control"], "no-store");
      assert.deepEqual(JSON.parse(response.text), {
        status: "maintenance", customerReady: false, accepted: false, error: "maintenance_unavailable",
      });
    }
  }
  assert.equal((await http(port, "POST", "/health")).status, 503);
  const head = await http(port, "HEAD", "/webhooks/openai");
  assert.equal(head.status, 503);
  assert.equal(head.text, "");
  assert.doesNotMatch(JSON.stringify(app.output()), /discard-me/);
  await assertNoApplicationImports(await imports(directory), directory);
  assert.ok(!(await readdir(directory)).includes("timer-attempts.txt"), "maintenance routes scheduled application timers");
});

test("upgrade, CONNECT and Expect requests get 503 without an interim acceptance", async t => {
  const directory = await fixture(t);
  const port = await availablePort();
  const app = launch(t, directory, { PORT: String(port) });
  await app.ready();
  for (const input of [
    "GET /voice/stream HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
    "CONNECT localhost:443 HTTP/1.1\r\nHost: localhost\r\n\r\n",
    "POST /webhooks/openai HTTP/1.1\r\nHost: localhost\r\nExpect: 100-continue\r\nContent-Length: 10\r\n\r\n",
    "GET /health HTTP/1.1\r\nHost: localhost\r\nExpect: custom-expectation\r\n\r\n",
  ]) {
    const response = await raw(port, input);
    assert.match(response, /^HTTP\/1\.1 503 /);
    assert.doesNotMatch(response, /100 Continue|101 Switching/);
    assert.match(response, /"accepted":false/);
  }
  const malformed = await raw(port, "INVALID HTTP\r\n\r\n");
  assert.match(malformed, /^HTTP\/1\.1 400 /);
  assert.equal((await http(port, "GET", "/health")).status, 200);
});

test("missing or explicit false maintenance selector imports the normal server unchanged", async t => {
  for (const flag of [undefined, "false"]) {
    await t.test(String(flag), async t => {
      const directory = await fixture(t);
      const app = launch(t, directory, {
        BOOKEDRADAR_MAINTENANCE_MODE: flag, BOOKEDRADAR_MAINTENANCE_SERVICE_ID: undefined,
        TEST_ALLOW_SERVER_IMPORT: "true", NODE_ENV: "test", RENDER_SERVICE_ID: "synthetic-other-service",
        RENDER_SERVICE_NAME: undefined, PORT: "unvalidated-normal-server-value", DATABASE_URL: "synthetic-original-url",
      });
      const result = await app.finished;
      assert.equal(result.code, 0, result.stderr);
      const normal = JSON.parse(result.stdout.trim());
      assert.equal(normal.event, "test.normal_server_imported");
      for (const [key, value] of Object.entries(app.env)) assert.equal(normal.env[key], value, key);
      const loaded = await imports(directory);
      assert.equal(loaded.at(-1), new URL("server.js", `file://${directory}/`).href);
      assert.equal(loaded.length, 4);
    });
  }
});

test("invalid/ambiguous flags, identities and settings fail closed before any app import", async t => {
  const cases = [
    ...["", "TRUE", "True", " false", "true ", "1", "0", "yes", "maintenance", "true,false"].map(value =>
      [{ BOOKEDRADAR_MAINTENANCE_MODE: value }, "maintenance_flag_invalid"]),
    [{ BOOKEDRADAR_MAINTENANCE_MODE: undefined }, "maintenance_target_without_mode"],
    [{ BOOKEDRADAR_MAINTENANCE_MODE: "false" }, "maintenance_target_without_mode"],
    ...[undefined, "", "srv-private-lab", `${serviceId} `].map(value =>
      [{ BOOKEDRADAR_MAINTENANCE_SERVICE_ID: value }, "maintenance_production_identity_required"]),
    ...[undefined, "", "srv-private-lab", `${serviceId} `].map(value =>
      [{ RENDER_SERVICE_ID: value }, "maintenance_production_identity_required"]),
    [{ RENDER_SERVICE_NAME: "bookedradar-private-lab" }, "maintenance_production_identity_required"],
    [{ RENDER_SERVICE_NAME: undefined }, "maintenance_production_identity_required"],
    [{ NODE_ENV: "test" }, "maintenance_production_identity_required"],
    [{ NODE_ENV: undefined }, "maintenance_production_identity_required"],
    ...[undefined, "json", "postgres_lab", "POSTGRES", "postgres "].map(value =>
      [{ BOOKEDRADAR_STORAGE_BACKEND: value }, "maintenance_production_storage_required"]),
    ...[undefined, "", "synthetic-secret-invalid-url", databaseUrl.replace("postgresql:", "https:"),
      databaseUrl.replace("dpg-date5bk9v7es738c22pg-a", "localhost"),
      databaseUrl.replace("dpg-date5bk9v7es738c22pg-a", "dpg-date5bk9v7es738c22pg-a.attacker.invalid"),
      databaseUrl.replace("bookedradar_postgres_production", "bookedradar_test"),
      databaseUrl.replace("/bookedradar_postgres", ":5433/bookedradar_postgres"),
      databaseUrl + "#synthetic-secret", " " + databaseUrl, databaseUrl + "\n"].map(value =>
      [{ DATABASE_URL: value }, "maintenance_database_identity_invalid"]),
    ...["?host=localhost", "?dbname=bookedradar_test", "?port=5433", "?sslmode=require&sslmode=disable",
      "?sslmode=unknown", "?options=synthetic-secret", "?service=alternate", "?sslmode=require&host=localhost"].map(value =>
      [{ DATABASE_URL: databaseUrl + value }, "maintenance_database_options_invalid"]),
    ...["", "0", "-1", "65536", "5050.0", "1e3", " 5050", "5050 ", "05050", "123x", "NaN", "Infinity"].map(value =>
      [{ PORT: value }, "maintenance_port_invalid"]),
  ];
  for (const [index, [overrides, error]] of cases.entries()) {
    await t.test(`case ${index + 1}: ${Object.keys(overrides)[0]} fails closed`, async t => {
      const directory = await fixture(t);
      const app = launch(t, directory, { PORT: "5050", TEST_ALLOW_SERVER_IMPORT: "true", ...overrides });
      const result = await app.finished;
      assert.equal(result.code, 1);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr.trim(), error);
      await assertNoApplicationImports(await imports(directory), directory);
      assert.doesNotMatch(result.stderr, /synthetic-secret|postgresql:|dpg-/);
    });
  }
});

test("unsupported entrypoint arguments cannot silently select normal mode", async t => {
  const directory = await fixture(t);
  const result = await launch(t, directory, {
    BOOKEDRADAR_MAINTENANCE_MODE: undefined, BOOKEDRADAR_MAINTENANCE_SERVICE_ID: undefined,
    TEST_ALLOW_SERVER_IMPORT: "true",
  }, ["--maintenance"]).finished;
  assert.equal(result.code, 1);
  assert.equal(result.stderr.trim(), "startup_arguments_not_supported");
  await assertNoApplicationImports(await imports(directory), directory);
});

test("equivalent PostgreSQL protocol/default port and recognized SSL option preserve maintenance isolation", async t => {
  const directory = await fixture(t);
  const port = await availablePort();
  const app = launch(t, directory, {
    PORT: String(port), DATABASE_URL: databaseUrl.replace("postgresql:", "postgres:")
      .replace("/bookedradar_postgres", ":5432/bookedradar_postgres") + "?sslmode=require",
    // Even hazardous app startup flags cannot start their import path here.
    DISPATCH_ENABLED: "true", POSTGRES_SHADOW_IMPORT_ON_STARTUP: "true",
    POSTGRES_JSON_ROLLBACK_ON_STARTUP: "true", CRM_SMOKE_TEST_ON_STARTUP: "true",
  });
  await app.ready();
  assert.equal((await http(port, "GET", "/health")).status, 200);
  await assertNoApplicationImports(await imports(directory), directory);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  test(`maintenance exits cleanly on ${signal} with an incomplete request socket`, async t => {
    const directory = await fixture(t);
    const port = await availablePort();
    const app = launch(t, directory, { PORT: String(port) });
    await app.ready();
    const socket = connect({ host: "127.0.0.1", port });
    socket.on("error", () => {});
    t.after(() => socket.destroy());
    await new Promise(resolve => socket.once("connect", resolve));
    socket.write("POST /webhooks/openai HTTP/1.1\r\nHost: localhost\r\nContent-Length: 99999\r\n");
    const timer = setTimeout(() => app.child.kill("SIGKILL"), 3_000);
    app.child.kill(signal);
    const result = await app.finished;
    clearTimeout(timer);
    assert.equal(result.code, 0);
    assert.equal(result.signal, null);
    assert.match(result.stdout, new RegExp(`"event":"maintenance.shutdown","signal":"${signal}"`));
    assert.equal(result.stderr, "");
    const timers = (await readFile(path.join(directory, "timer-attempts.txt"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
    assert.deepEqual(timers, [{ kind: "setTimeout", delay: 1_000 }]);
  });
}

test("listen failures exit nonzero and emit only a sanitized error", async t => {
  const directory = await fixture(t);
  const holder = createServer();
  await new Promise(resolve => holder.listen(0, "0.0.0.0", resolve));
  t.after(() => new Promise(resolve => holder.close(resolve)));
  const result = await launch(t, directory, { PORT: String(holder.address().port) }).finished;
  assert.equal(result.code, 1);
  assert.equal(result.stderr.trim(), "maintenance_listen_failed");
  assert.doesNotMatch(result.stdout, /maintenance.listening/);
  await assertNoApplicationImports(await imports(directory), directory);
});

test("normal server import failure stays nonzero without printing raw error data", async t => {
  const directory = await fixture(t);
  const result = await launch(t, directory, {
    BOOKEDRADAR_MAINTENANCE_MODE: undefined, BOOKEDRADAR_MAINTENANCE_SERVICE_ID: undefined,
    TEST_ALLOW_SERVER_IMPORT: "true", TEST_SERVER_IMPORT_FAIL: "true",
  }).finished;
  assert.equal(result.code, 1);
  assert.equal(result.stderr.trim(), "startup_failed");
  assert.doesNotMatch(result.stdout + result.stderr, /synthetic-secret/);
});

test("log-only instance/build identity is sanitized and shares a unique ID across each boot", async t => {
  const bootIds = new Set();
  const cases = [
    [{ RENDER_INSTANCE_ID: `${serviceId}-synthetic`, RENDER_GIT_COMMIT: "A".repeat(40), RENDER_DEPLOY_ID: "dep-synthetic123" },
      { instance_id: `${serviceId}-synthetic`, commit_id: "a".repeat(40), deploy_id: "dep-synthetic123" }],
    [{ RENDER_INSTANCE_ID: "synthetic-secret\nnew-line", RENDER_GIT_COMMIT: "synthetic-secret", RENDER_DEPLOY_ID: "https://synthetic-secret" },
      { instance_id: null, commit_id: null, deploy_id: null }],
    [{}, { instance_id: null, commit_id: null, deploy_id: null }],
  ];
  for (const [overrides, expected] of cases) {
    const directory = await fixture(t);
    const port = await availablePort();
    const app = launch(t, directory, { PORT: String(port), ...overrides });
    await app.ready();
    const publicHealth = await http(port, "GET", "/health");
    assert.doesNotMatch(publicHealth.text, /instance_id|boot_id|deploy_id|commit_id/);
    app.child.kill("SIGTERM");
    const result = await app.finished;
    assert.equal(result.code, 0);
    const [listening, shutdown] = result.stdout.trim().split("\n").map(line => JSON.parse(line));
    for (const [key, value] of Object.entries(expected)) {
      assert.equal(listening[key], value);
      assert.equal(shutdown[key], value);
    }
    assert.match(listening.boot_id, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
    assert.equal(shutdown.boot_id, listening.boot_id);
    assert.ok(!bootIds.has(listening.boot_id));
    bootIds.add(listening.boot_id);
    assert.doesNotMatch(result.stdout + result.stderr, /synthetic-secret/);
    await assertNoApplicationImports(await imports(directory), directory);
  }
});

test("repository launch wiring remains on the original server until separately approved", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(packageJson.scripts.start, "node server.js");
  const dockerfile = await readFile(path.join(root, "Dockerfile"), "utf8");
  assert.match(dockerfile, /CMD \["node", "server\.js"\]/);
  assert.doesNotMatch(await readFile(path.join(root, "render.yaml"), "utf8"), /startup\.mjs|MAINTENANCE_MODE/);
});

test("the subprocess transport guard blocks outbound socket, HTTP and fetch attempts", async t => {
  const directory = await fixture(t);
  const child = spawn(process.execPath, ["--require", "./transport.cjs", "--input-type=module", "--eval",
    `import assert from 'node:assert/strict';
     import net from 'node:net';
     import http from 'node:http';
     for (const effect of [() => net.connect(9, '127.0.0.1'), () => http.get('http://127.0.0.1:9'), () => fetch('https://example.invalid')]) {
       assert.throws(effect, /forbidden_transport_attempt/);
     }`,
  ], { cwd: directory, env: {}, stdio: ["ignore", "pipe", "pipe"] });
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  assert.equal(code, 0);
  const attempts = (await readFile(path.join(directory, "transport-attempts.txt"), "utf8")).trim().split("\n");
  assert.equal(attempts.length, 3);
});

test("the import guard detects an injected application import even without installed dependencies", async t => {
  const directory = await fixture(t);
  // Mutate only the temporary test copy to prove the guard itself fails closed.
  await appendFile(path.join(directory, "startup.mjs"), '\nawait import("./server.js");\n');
  const result = await launch(t, directory, { PORT: String(await availablePort()) }).finished;
  assert.equal(result.code, 1);
  assert.match(result.stderr, /forbidden_startup_import/);
  assert.equal((await imports(directory)).at(-1), new URL("server.js", `file://${directory}/`).href);
});

test("the maintenance preload rejects application intervals before they can run", async t => {
  const directory = await fixture(t);
  await appendFile(path.join(directory, "startup.mjs"), '\nsetInterval(() => {}, 1000);\n');
  const result = await launch(t, directory, { PORT: String(await availablePort()) }).finished;
  assert.equal(result.code, 1);
  assert.match(result.stderr, /forbidden_maintenance_interval/);
  const timers = (await readFile(path.join(directory, "timer-attempts.txt"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(timers, [{ kind: "setInterval", delay: 1_000 }]);
});
