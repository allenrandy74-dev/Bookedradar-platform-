import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RecoveryStore } from "../src/recovery/store.js";

test("action claiming prevents two workers from taking the same action", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "br-claim-"));
  const store = new RecoveryStore(path.join(dir, "state.json"));
  await store.scheduleAction({
    tenantId: "t1",
    opportunityId: "o1",
    contactKey: "t1:c1",
    channel: "human_task",
    template: "x",
    purpose: "service",
    dueAt: new Date(Date.now() - 1000).toISOString(),
  });

  const a = await store.claimDueActions({ workerId: "a" });
  const b = await store.claimDueActions({ workerId: "b" });

  assert.equal(a.length, 1);
  assert.equal(b.length, 0);
});
