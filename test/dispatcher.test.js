import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { RecoveryStore } from "../src/recovery/store.js";
import { RecoveryEngine } from "../src/recovery/engine.js";
import { ActionDispatcher } from "../src/integrations/dispatcher.js";

function tenant() {
  return {
    tenantId: "t1",
    businessName: "Test HVAC",
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

test("dispatcher executes one due action exactly once", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "br-dispatch-"));
  const store = new RecoveryStore(path.join(dir, "state.json"));
  const engine = new RecoveryEngine({ store, tenant: tenant() });

  const result = await engine.ingest({
    idempotencyKey: "miss-1",
    type: "missed_call",
    occurredAt: new Date(Date.now() - 60_000).toISOString(),
    contact: {
      phone: "+14095550111",
      transactionalSmsAllowed: true,
    },
  });

  let sends = 0;
  const dispatcher = new ActionDispatcher({
    store,
    tenant: tenant(),
    adapters: {
      sms: { send: async () => { sends += 1; return { sid: "x" }; } },
      human_task: { send: async () => ({ taskId: "t" }) },
    },
  });

  await dispatcher.runOnce({ now: new Date(), limit: 10 });
  await dispatcher.runOnce({ now: new Date(), limit: 10 });

  assert.equal(sends, 1);
});
