import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RecoveryStore } from "../src/recovery/store.js";
import { RecoveryEngine } from "../src/recovery/engine.js";
import { radarProof } from "../src/recovery/radarproof.js";

const tenant = {
  tenantId: "terminal-test", businessName: "Terminal Test", trade: "HVAC",
  timeZone: "America/Chicago", serviceArea: ["X"],
  escalation: { humanPhone: "+14095550000" },
  policies: { bookingMode: "confirm_only", sms: { allowTransactionalWhenInbound: true } },
  economics: { defaultAverageJobValue: 700 },
};

test("booking_confirmed marks opportunity recovered and stops recovery actions", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "br-terminal-"));
  const store = new RecoveryStore(path.join(dir, "state.json"));
  const engine = new RecoveryEngine({ store, tenant });
  const created = await engine.ingest({
    idempotencyKey: "miss-a", type: "missed_call",
    contact: { phone: "+14095550123", transactionalSmsAllowed: true },
  });
  const booked = await engine.ingest({
    idempotencyKey: "book-a", type: "booking_confirmed",
    opportunityId: created.opportunity.id, bookingId: "booking-1",
  });
  assert.equal(booked.recovered, true);
  const proof = await radarProof(store, tenant.tenantId);
  assert.equal(proof.recoveredOpportunities, 1);
  const snapshot = await store.snapshot();
  const actions = Object.values(snapshot.actions).filter(a => a.opportunityId === created.opportunity.id);
  assert.ok(actions.every(a => ["cancelled", "completed", "blocked"].includes(a.status)));
});
