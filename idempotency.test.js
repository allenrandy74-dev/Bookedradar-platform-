import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RecoveryStore } from "../src/recovery/store.js";
import { RecoveryEngine } from "../src/recovery/engine.js";

function tenant() {
  return {
    tenantId: "t1",
    businessName: "T1",
    trade: "HVAC",
    timeZone: "America/Chicago",
    serviceArea: ["X"],
    escalation: { humanPhone: "+14095550100" },
    policies: {
      bookingMode: "confirm_only",
      sms: { allowTransactionalWhenInbound: true },
    },
    economics: { defaultAverageJobValue: 500 },
  };
}

test("duplicate event key does not create a second opportunity or actions", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "br-idem-"));
  const store = new RecoveryStore(path.join(dir, "state.json"));
  const engine = new RecoveryEngine({ store, tenant: tenant() });

  const event = {
    idempotencyKey: "source-123",
    type: "missed_call",
    contact: { phone: "+14095550111", transactionalSmsAllowed: true },
  };

  const first = await engine.ingest(event);
  const second = await engine.ingest(event);
  const snapshot = await store.snapshot();

  assert.ok(first.opportunity);
  assert.equal(second.duplicate, true);
  assert.equal(Object.keys(snapshot.opportunities).length, 1);
  assert.equal(
    Object.values(snapshot.actions).filter(a => a.opportunityId === first.opportunity.id).length,
    first.actions.length
  );
});

test("same phone number is namespaced by tenant", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "br-tenant-"));
  const store = new RecoveryStore(path.join(dir, "state.json"));
  const e1 = new RecoveryEngine({ store, tenant: tenant() });
  const t2 = { ...tenant(), tenantId: "t2", businessName: "T2" };
  const e2 = new RecoveryEngine({ store, tenant: t2 });

  await e1.ingest({
    idempotencyKey: "t1-evt",
    type: "missed_call",
    contact: { phone: "+14095550111", transactionalSmsAllowed: true },
  });
  await e2.ingest({
    idempotencyKey: "t2-evt",
    type: "missed_call",
    contact: { phone: "+14095550111", transactionalSmsAllowed: true },
  });

  const snapshot = await store.snapshot();
  assert.ok(snapshot.contacts["t1:+14095550111"]);
  assert.ok(snapshot.contacts["t2:+14095550111"]);
});
