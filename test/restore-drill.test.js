import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createBackup } from "../scripts/backup.js";
import { runRestoreDrill } from "../scripts/restore-drill.mjs";

test("restore drill validates a complete encrypted snapshot and reports recovery time", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "br-restore-drill-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const names = [
    "state.json",
    "recovery-state.json",
    "leads.jsonl",
    "voice-transfers.json",
    "billing-test-state.json",
    "billing-live-state.json",
    "call-history.json",
    "web-chat.json",
  ];
  const sources = {};
  for (const name of names) {
    const file = path.join(root, name);
    sources[name] = file;
    const body = name.endsWith(".jsonl")
      ? JSON.stringify({ store: name, marker: "drill" }) + "\n"
      : JSON.stringify({ store: name, marker: "drill" });
    await fs.writeFile(file, body, "utf8");
  }

  const key = "ef".repeat(32);
  const archive = path.join(root, "snapshot.brbackup");
  await createBackup({ sources, destination: archive, key, quiesced: true });

  const report = await runRestoreDrill({
    archive,
    key,
    destinationRoot: path.join(root, "restores"),
  });

  assert.equal(report.ok, true);
  assert.equal(report.complete, true);
  assert.equal(report.restored.length, names.length);
  assert.equal(report.validatedStores.length, names.length);
  assert.ok(Number.isFinite(report.elapsedMs));
  assert.ok(report.elapsedMs >= 0);

  for (const name of names) {
    assert.deepEqual(
      await fs.readFile(path.join(report.destination, name)),
      await fs.readFile(sources[name])
    );
  }
});

test("restore drill refuses a wrong encryption key", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "br-restore-drill-key-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const source = path.join(root, "state.json");
  await fs.writeFile(source, JSON.stringify({ safe: true }));
  const archive = path.join(root, "snapshot.brbackup");
  await createBackup({
    sources: { "state.json": source },
    destination: archive,
    key: "11".repeat(32),
    quiesced: true,
  });

  await assert.rejects(
    runRestoreDrill({
      archive,
      key: "22".repeat(32),
      destinationRoot: path.join(root, "restores"),
    })
  );
});
