import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createBackup, restoreBackup } from "./backup.js";

const STORE_NAMES = [
  "state.json",
  "recovery-state.json",
  "leads.jsonl",
  "voice-transfers.json",
  "billing-test-state.json",
  "billing-live-state.json",
  "call-history.json",
  "web-chat.json",
];

async function validateRestoredDirectory(directory) {
  const files = await fs.readdir(directory);
  const present = STORE_NAMES.filter(name => files.includes(name));
  for (const name of present) {
    const raw = await fs.readFile(path.join(directory, name), "utf8");
    if (name.endsWith(".jsonl")) {
      for (const line of raw.split("\n").filter(Boolean)) JSON.parse(line);
    } else {
      JSON.parse(raw);
    }
  }
  return present;
}

export async function runRestoreDrill({ archive, key, destinationRoot }) {
  if (!archive) throw new Error("BACKUP_ARCHIVE is required");
  if (!key) throw new Error("BACKUP_ENCRYPTION_KEY is required");

  const root = destinationRoot || await fs.mkdtemp(path.join(os.tmpdir(), "bookedradar-restore-drill-"));
  const destination = path.join(root, `restore-${Date.now()}-${randomBytes(3).toString("hex")}`);

  const startedAt = Date.now();
  const restore = await restoreBackup({ archive, destination, key });
  const present = await validateRestoredDirectory(destination);
  const elapsedMs = Date.now() - startedAt;

  return {
    ok: true,
    archive: path.resolve(archive),
    destination,
    elapsedMs,
    restored: restore.restored,
    missing: restore.missing || [],
    validatedStores: present,
    complete: (restore.missing || []).length === 0,
  };
}

async function syntheticSelfTest() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bookedradar-dr-selftest-"));
  const key = "ab".repeat(32);
  const sources = {};
  for (const name of STORE_NAMES) {
    const file = path.join(root, name);
    sources[name] = file;
    const body = name.endsWith(".jsonl")
      ? JSON.stringify({ synthetic: true, name }) + "\n"
      : JSON.stringify({ synthetic: true, name });
    await fs.writeFile(file, body, "utf8");
  }

  const archive = path.join(root, "synthetic.brbackup");
  await createBackup({ sources, destination: archive, key, quiesced: true });
  const report = await runRestoreDrill({
    archive,
    key,
    destinationRoot: path.join(root, "drill"),
  });
  return { ...report, synthetic: true };
}

export async function main() {
  const selfTest = process.argv.includes("--self-test");
  const report = selfTest
    ? await syntheticSelfTest()
    : await runRestoreDrill({
        archive: process.env.BACKUP_ARCHIVE,
        key: process.env.BACKUP_ENCRYPTION_KEY,
        destinationRoot: process.env.RESTORE_DRILL_ROOT,
      });

  console.log(JSON.stringify({
    event: "restore.drill",
    ...report,
  }));
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(JSON.stringify({
      event: "restore.drill",
      ok: false,
      error: String(error?.message || "restore_drill_failed"),
    }));
    process.exitCode = 1;
  });
}
