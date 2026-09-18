import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JsonStateStore } from "../src/state-store.js";

test("persistent webhook dedupe survives store re-instantiation", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "br-state-"));
  const file = path.join(dir, "state.json");
  const a = new JsonStateStore(file);
  assert.equal(await a.markWebhookOnce("wh_1"), true);
  assert.equal(await a.markWebhookOnce("wh_1"), false);
  const b = new JsonStateStore(file);
  assert.equal(await b.markWebhookOnce("wh_1"), false);
});
