import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RecoveryStore } from "../src/recovery/store.js";

test("tenant-scoped action claim does not take another tenant's action", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "br-tclaim-"));
  const store = new RecoveryStore(path.join(dir, "state.json"));
  const dueAt = new Date(Date.now() - 1000).toISOString();

  await store.scheduleAction({
    tenantId: "a", opportunityId: "oa", contactKey: "a:c",
    channel: "human_task", template: "a", purpose: "service", dueAt,
  });
  await store.scheduleAction({
    tenantId: "b", opportunityId: "ob", contactKey: "b:c",
    channel: "human_task", template: "b", purpose: "service", dueAt,
  });

  const a = await store.claimDueActions({ tenantId: "a", workerId: "wa" });
  assert.equal(a.length, 1);
  assert.equal(a[0].tenantId, "a");

  const b = await store.claimDueActions({ tenantId: "b", workerId: "wb" });
  assert.equal(b.length, 1);
  assert.equal(b[0].tenantId, "b");
});
