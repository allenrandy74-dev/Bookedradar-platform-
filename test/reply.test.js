import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RecoveryStore } from "../src/recovery/store.js";
import { RecoveryEngine } from "../src/recovery/engine.js";

const tenant = {
  tenantId: "reply-test", businessName: "Reply Test", trade: "HVAC",
  timeZone: "America/Chicago", serviceArea: ["X"],
  escalation: { humanPhone: "+14095550000" },
  policies: { bookingMode: "confirm_only", sms: { allowTransactionalWhenInbound: true } },
  economics: { defaultAverageJobValue: 500 },
};

test("customer reply cancels pending automated touches", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "br-reply-"));
  const store = new RecoveryStore(path.join(dir, "state.json"));
  const engine = new RecoveryEngine({ store, tenant });
  const created = await engine.ingest({
    idempotencyKey: "estimate-a", type: "estimate_sent", estimateAmount: 10000,
    contact: { email: "customer@example.com" },
  });
  const result = await engine.ingest({
    idempotencyKey: "reply-a", type: "customer_replied", opportunityId: created.opportunity.id,
  });
  assert.equal(result.engaged, true);
  assert.ok(result.cancelledAutomatedActions >= 1);
  const snapshot = await store.snapshot();
  const automated = Object.values(snapshot.actions).filter(
    a => a.opportunityId === created.opportunity.id && ["sms", "email"].includes(a.channel)
  );
  assert.ok(automated.every(a => a.status === "cancelled"));
});
