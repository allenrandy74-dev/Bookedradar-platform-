import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RecoveryStore } from "../src/recovery/store.js";
import { RecoveryEngine } from "../src/recovery/engine.js";
import { radarProof } from "../src/recovery/radarproof.js";

function tenant(id) {
  return {
    tenantId: id,
    businessName: id,
    trade: "HVAC",
    timeZone: "America/Chicago",
    serviceArea: ["X"],
    escalation: { humanPhone: "+14095550000" },
    policies: {
      bookingMode: "confirm_only",
      sms: { allowTransactionalWhenInbound: true },
    },
    economics: { defaultAverageJobValue: id === "a" ? 500 : 900 },
  };
}

test("RadarProof is isolated per tenant", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "br-rp-"));
  const store = new RecoveryStore(path.join(dir, "state.json"));
  const a = new RecoveryEngine({ store, tenant: tenant("a") });
  const b = new RecoveryEngine({ store, tenant: tenant("b") });

  await a.ingest({
    idempotencyKey: "a1",
    type: "missed_call",
    contact: { phone: "+14095550101", transactionalSmsAllowed: true },
  });
  await b.ingest({
    idempotencyKey: "b1",
    type: "missed_call",
    contact: { phone: "+14095550102", transactionalSmsAllowed: true },
  });

  const ra = await radarProof(store, "a");
  const rb = await radarProof(store, "b");
  assert.equal(ra.opportunitiesCaptured, 1);
  assert.equal(rb.opportunitiesCaptured, 1);
  assert.equal(ra.estimatedOpportunityValue, 500);
  assert.equal(rb.estimatedOpportunityValue, 900);
});
