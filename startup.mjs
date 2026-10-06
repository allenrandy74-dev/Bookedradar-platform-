// Default container entrypoint. Maintenance remains an explicit, validated opt-in.
// Keep every application/config/store/provider import below the mode decision.
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const PRODUCTION_SERVICE_ID = "srv-dam8f7bm8hqs73ct778g";
const PRODUCTION_DATABASE_HOST = "dpg-date5bk9v7es738c22pg-a";
const PRODUCTION_DATABASE_PATH = "/bookedradar_postgres_production";

class StartupConfigurationError extends Error {}

function reject(code) {
  throw new StartupConfigurationError(code);
}

function maintenanceRequested(env) {
  // Exact strings only: empty, whitespace, case variants and numeric booleans
  // must never silently fall through to a customer-serving application.
  if (process.argv.length !== 2) reject("startup_arguments_not_supported");
  const flag = env.BOOKEDRADAR_MAINTENANCE_MODE;
  if (flag !== undefined && flag !== "false" && flag !== "true") {
    reject("maintenance_flag_invalid");
  }
  if (flag !== "true") {
    if (env.BOOKEDRADAR_MAINTENANCE_SERVICE_ID !== undefined) {
      reject("maintenance_target_without_mode");
    }
    return false;
  }
  if (env.BOOKEDRADAR_MAINTENANCE_SERVICE_ID !== PRODUCTION_SERVICE_ID ||
      env.RENDER_SERVICE_ID !== PRODUCTION_SERVICE_ID ||
      env.RENDER_SERVICE_NAME !== "bookedradar-platform" ||
      env.NODE_ENV !== "production") {
    reject("maintenance_production_identity_required");
  }
  if (env.BOOKEDRADAR_STORAGE_BACKEND !== "postgres") {
    reject("maintenance_production_storage_required");
  }

  // Compare configured identity only. No driver, DNS lookup or connection.
  // Never include the URL, credentials, or parser error in logs/responses.
  const rawUrl = env.DATABASE_URL;
  let database;
  try { database = new URL(rawUrl); } catch {
    reject("maintenance_database_identity_invalid");
  }
  if (typeof rawUrl !== "string" || rawUrl !== rawUrl.trim() ||
      /[\r\n\t]/.test(rawUrl) ||
      !["postgres:", "postgresql:"].includes(database.protocol) ||
      database.hostname !== PRODUCTION_DATABASE_HOST ||
      database.pathname !== PRODUCTION_DATABASE_PATH ||
      !["", "5432"].includes(database.port) || database.hash) {
    reject("maintenance_database_identity_invalid");
  }
  // libpq-style query parameters can override the authority/database. Only a
  // single recognized sslmode is allowed; reject alternate/duplicate routing.
  const parameters = [...database.searchParams.entries()];
  if (parameters.length > 1 || parameters.some(([key, value]) =>
    key !== "sslmode" || !["disable", "prefer", "require", "verify-ca", "verify-full"].includes(value))) {
    reject("maintenance_database_options_invalid");
  }
  return true;
}

function maintenancePort(env) {
  const raw = env.PORT === undefined ? "5050" : env.PORT;
  if (!/^[1-9][0-9]{0,4}$/.test(raw) || Number(raw) > 65535) {
    reject("maintenance_port_invalid");
  }
  return Number(raw);
}

function startMaintenance(port) {
  const safeId = value => /^[A-Za-z0-9_-]{1,160}$/.test(value || "") ? value : null;
  const identity = {
    instance_id: safeId(process.env.RENDER_INSTANCE_ID),
    commit_id: /^[a-fA-F0-9]{40}$/.test(process.env.RENDER_GIT_COMMIT || "")
      ? process.env.RENDER_GIT_COMMIT.toLowerCase() : null,
    deploy_id: /^dep-[A-Za-z0-9]{1,100}$/.test(process.env.RENDER_DEPLOY_ID || "")
      ? process.env.RENDER_DEPLOY_ID : null,
    boot_id: randomUUID(),
  };
  const health = JSON.stringify({
    status: "maintenance", mode: "maintenance", customerReady: false, acceptingWork: false,
  });
  const unavailable = JSON.stringify({
    status: "maintenance", customerReady: false, accepted: false, error: "maintenance_unavailable",
  });
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Connection": "close",
  };
  const reply = (request, response, allowHealth = true) => {
    const isHealth = allowHealth && request.url === "/health" &&
      (request.method === "GET" || request.method === "HEAD");
    const body = isHealth ? health : unavailable;
    response.writeHead(isHealth ? 200 : 503, {
      ...headers, "Content-Length": Buffer.byteLength(body),
      ...(isHealth ? {} : { "Retry-After": "60" }),
    });
    response.end(request.method === "HEAD" ? undefined : body);
    // Discard without parsing or storing request payloads. Connection: close
    // prevents maintenance traffic from leaving reusable keep-alive sockets.
    request.resume();
  };
  const server = createServer({
    requestTimeout: 5_000, headersTimeout: 5_000, keepAliveTimeout: 1_000,
    maxHeaderSize: 16_384,
  }, reply);
  const sockets = new Set();
  server.on("connection", socket => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  // Do not emit even an interim 100 acknowledgement for work/webhook bodies.
  server.on("checkContinue", (request, response) => reply(request, response, false));
  server.on("checkExpectation", (request, response) => reply(request, response, false));
  const rejectUpgrade = (_request, socket) => {
    socket.on("error", () => socket.destroy());
    socket.setTimeout(1_000, () => socket.destroy());
    socket.end("HTTP/1.1 503 Service Unavailable\r\n" +
      "Content-Type: application/json; charset=utf-8\r\n" +
      "Cache-Control: no-store\r\nRetry-After: 60\r\nConnection: close\r\n" +
      `Content-Length: ${Buffer.byteLength(unavailable)}\r\n\r\n${unavailable}`);
  };
  server.on("upgrade", rejectUpgrade);
  server.on("connect", rejectUpgrade);

  let stopping = false;
  const stop = (signal, exitCode = 0) => {
    if (stopping) return;
    stopping = true;
    process.exitCode = exitCode;
    console.log(JSON.stringify({ event: "maintenance.shutdown", signal, ...identity }));
    const deadline = setTimeout(() => process.exit(1), 1_000);
    deadline.unref();
    server.close(() => {
      clearTimeout(deadline);
      process.off("SIGTERM", onTerm);
      process.off("SIGINT", onInt);
    });
    // Maintenance owns no call controllers or accepted work to drain. Include
    // upgraded, incomplete and idle sockets so shutdown cannot hang on clients.
    for (const socket of sockets) socket.destroy();
  };
  const onTerm = () => stop("SIGTERM");
  const onInt = () => stop("SIGINT");
  process.on("SIGTERM", onTerm);
  process.on("SIGINT", onInt);
  server.on("error", () => {
    console.error("maintenance_listen_failed");
    stop("server_error", 1);
  });
  server.listen(port, "0.0.0.0", () => {
    console.log(JSON.stringify({ event: "maintenance.listening", port, customerReady: false, ...identity }));
  });
}

try {
  if (maintenanceRequested(process.env)) {
    startMaintenance(maintenancePort(process.env));
  } else {
    // Preserve the existing app and every runtime flag. Never import this at
    // module scope, including indirectly through shared configuration helpers.
    await import("./server.js");
  }
} catch (error) {
  console.error(error instanceof StartupConfigurationError ? error.message : "startup_failed");
  // A failed normal import may already have created timers. Do not leave a
  // partially initialized worker alive after the entrypoint has failed.
  process.exit(1);
}
