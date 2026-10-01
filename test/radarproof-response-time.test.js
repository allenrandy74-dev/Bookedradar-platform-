import test from "node:test";
import assert from "node:assert/strict";
import { radarProof } from "../src/recovery/radarproof.js";

const snapshot = events => ({ snapshot: async () => ({
  opportunities: {}, attribution: {}, actions: {}, events,
}) });

test("response times belong to the selected tenant and report window", async () => {
  const store = snapshot([
    { tenantId: "a", occurredAt: "2026-10-01T00:00:00Z", responseLatencySeconds: 4 },
    { tenantId: "a", occurredAt: "2026-10-01T01:00:00Z", responseLatencySeconds: 8 },
    { tenantId: "b", occurredAt: "2026-10-01T00:00:00Z", responseLatencySeconds: 1000 },
    { tenantId: "a", occurredAt: "2026-09-01T00:00:00Z", responseLatencySeconds: 1000 },
    { occurredAt: "2026-10-01T00:00:00Z", responseLatencySeconds: 1000 },
  ]);
  const report = await radarProof(store, "a", { sinceMs: Date.parse("2026-10-01T00:00:00Z") });
  assert.equal(report.medianResponseSeconds, 6);
});

test("missing, blank, negative and malformed response times are not zero-second successes", async () => {
  const events = [null, "", " ", -1, "invalid", {}, [], true, false].map(responseLatencySeconds => ({ tenantId: "a", responseLatencySeconds }));
  events.push({ tenantId: "a" });
  assert.equal((await radarProof(snapshot(events), "a")).medianResponseSeconds, null);
  events.push({ tenantId: "a", responseLatencySeconds: 0 }, { tenantId: "a", responseLatencySeconds: "4" });
  assert.equal((await radarProof(snapshot(events), "a")).medianResponseSeconds, 2);
});

test("an unfiltered report keeps valid response times across tenants", async () => {
  const store = snapshot([{ tenantId: "a", responseLatencySeconds: 2 }, { tenantId: "b", responseLatencySeconds: 8 }]);
  assert.equal((await radarProof(store)).medianResponseSeconds, 5);
});
