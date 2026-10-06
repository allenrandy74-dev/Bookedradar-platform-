// Subprocess-only loader for dependency-free startup tests. It never executes
// the real server. The normal branch's exact server import is intercepted.
import { appendFileSync } from "node:fs";

const entry = new URL("./startup.mjs", import.meta.url).href;
const server = new URL("./server.js", import.meta.url).href;
export async function resolve(specifier, context, nextResolve) {
  const target = specifier.startsWith(".") ? new URL(specifier, context.parentURL).href : specifier;
  appendFileSync(new URL("./imports.txt", import.meta.url), target + "\n");
  if (target === entry || target === "node:http" || target === "node:crypto") return nextResolve(specifier, context);
  if (target === server && process.env.TEST_ALLOW_SERVER_IMPORT === "true") {
    return { url: server, shortCircuit: true };
  }
  throw new Error("forbidden_startup_import");
}
export async function load(url, context, nextLoad) {
  if (url === server) {
    return {
      format: "module", shortCircuit: true,
      source: process.env.TEST_SERVER_IMPORT_FAIL === "true"
        ? "setInterval(() => {}, 1000); throw new Error('synthetic-secret-must-not-be-logged');"
        : "console.log(JSON.stringify({event:'test.normal_server_imported', env:process.env}));",
    };
  }
  return nextLoad(url, context);
}
