import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createCallLifecycle } from "../src/call-lifecycle.js";
import { JsonStateStore } from "../src/state-store.js";
import { CallHistoryStore } from "../src/call-history.js";
import { TenantRegistry } from "../src/recovery/tenant-registry.js";

const demoRoutes = [
  ["+14092574186", "demo-hvac"],
  ["+14095477916", "demo-plumbing"],
  ["+14092139980", "demo-electrical"],
  ["+14092321112", "demo-roofing"],
  ["+14092304297", "demo-home-services"],
];

test("concurrency lab: lifecycle tracks many simultaneous calls without collisions", () => {
  const logs = [];
  const lifecycle = createCallLifecycle({
    log: (event, fields) => logs.push({ event, ...fields }),
    exit: () => { throw new Error("unexpected exit"); },
  });

  const ids = Array.from({ length: 100 }, (_, i) => `sim-call-${i}`);
  for (const id of ids) assert.equal(lifecycle.begin(id), true);
  assert.equal(lifecycle.count(), 100);

  // Duplicates must be rejected without changing the active-call count.
  for (const id of ids.slice(0, 20)) assert.equal(lifecycle.begin(id), false);
  assert.equal(lifecycle.count(), 100);

  for (const id of ids.slice(0, 50)) lifecycle.end(id);
  assert.equal(lifecycle.count(), 50);

  for (const id of ids.slice(50)) lifecycle.end(id);
  assert.equal(lifecycle.count(), 0);

  assert.equal(
    logs.filter(x => x.event === "call.control_started").length,
    100
  );
  assert.equal(
    logs.filter(x => x.event === "call.control_ended").length,
    100
  );
});

test("concurrency lab: all five public demo numbers resolve to the correct craft", async () => {
  const registry = await TenantRegistry.loadDirectory("./config/tenants");
  for (const [phone, tenantId] of demoRoutes) {
    const tenant = registry.resolveByPhone(phone);
    assert.ok(tenant, `expected tenant for ${phone}`);
    assert.equal(tenant.tenantId, tenantId);
  }
});

test("concurrency lab: concurrent per-call state writes stay isolated across crafts", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bookedradar-state-concurrency-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const state = new JsonStateStore(path.join(dir, "state.json"));
  await state.load();

  const calls = Array.from({ length: 75 }, (_, i) => {
    const [dialed, tenantId] = demoRoutes[i % demoRoutes.length];
    return {
      callId: `state-call-${i}`,
      tenantId,
      dialed,
      seq: i,
    };
  });

  await Promise.all(
    calls.map(call =>
      state.patchCall(call.callId, {
        tenantId: call.tenantId,
        dialedNumberMasked: call.dialed,
        sequence: call.seq,
        phase: "accepted",
      })
    )
  );

  await Promise.all(
    calls.map(call =>
      state.patchCall(call.callId, {
        phase: "sideband_open",
        marker: `marker-${call.seq}`,
      })
    )
  );

  for (const call of calls) {
    const stored = await state.getCall(call.callId);
    assert.equal(stored.tenantId, call.tenantId);
    assert.equal(stored.dialedNumberMasked, call.dialed);
    assert.equal(stored.sequence, call.seq);
    assert.equal(stored.phase, "sideband_open");
    assert.equal(stored.marker, `marker-${call.seq}`);
  }

  const persisted = JSON.parse(await fs.readFile(path.join(dir, "state.json"), "utf8"));
  assert.equal(Object.keys(persisted.calls).length, calls.length);
});

test("concurrency lab: call history handles overlapping calls and keeps tenant stats separate", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bookedradar-history-concurrency-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const history = new CallHistoryStore(path.join(dir, "history.json"), { retentionDays: 30 });
  await history.load();

  const calls = Array.from({ length: 50 }, (_, i) => {
    const [dialed, tenantId] = demoRoutes[i % demoRoutes.length];
    return {
      callId: `history-call-${i}`,
      tenantId,
      dialed,
      seq: i,
    };
  });

  await Promise.all(
    calls.map(call =>
      history.start(call.callId, {
        tenantId: call.tenantId,
        callerMasked: `***${String(call.seq).padStart(2, "0")}`,
        dialedMasked: call.dialed,
      })
    )
  );

  await Promise.all(
    calls.map(call =>
      history.addTurn(call.callId, {
        speaker: "caller",
        text: `synthetic caller ${call.seq} for ${call.tenantId}`,
        itemId: `caller-${call.seq}`,
      })
    )
  );

  await Promise.all(
    calls.map(call =>
      history.addTurn(call.callId, {
        speaker: "assistant",
        text: `synthetic assistant response ${call.seq}`,
        itemId: `assistant-${call.seq}`,
      })
    )
  );

  await Promise.all(
    calls.map(call =>
      history.finish(call.callId, {
        transferred: call.seq % 7 === 0,
        leadSummary: {
          serviceType: "synthetic_test",
          callback: "+14095550000",
          urgency: "test",
          preferredWindow: "test",
        },
      })
    )
  );

  for (const [, tenantId] of demoRoutes) {
    const stats = await history.stats(tenantId);
    assert.equal(stats.callsHandled, 10);
    assert.equal(stats.callsWithTranscript, 10);
  }

  for (const call of calls) {
    const record = await history.get(call.tenantId, call.callId);
    assert.ok(record);
    assert.equal(record.tenantId, call.tenantId);
    assert.equal(record.transcript.length, 2);
    assert.match(record.transcript[0].text, new RegExp(String(call.seq)));
    assert.match(record.transcript[1].text, new RegExp(String(call.seq)));
  }
});

test("concurrency lab: multiple simultaneous calls to the same craft remain distinct", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bookedradar-same-craft-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const state = new JsonStateStore(path.join(dir, "state.json"));
  const history = new CallHistoryStore(path.join(dir, "history.json"), { retentionDays: 30 });
  await Promise.all([state.load(), history.load()]);

  const calls = Array.from({ length: 25 }, (_, i) => ({
    callId: `hvac-overlap-${i}`,
    tenantId: "demo-hvac",
    marker: `hvac-${i}`,
  }));

  await Promise.all(calls.map(async call => {
    await state.patchCall(call.callId, {
      tenantId: call.tenantId,
      marker: call.marker,
      lastLead: { service_type: `hvac_case_${call.marker}` },
    });
    await history.start(call.callId, {
      tenantId: call.tenantId,
      callerMasked: "***TEST",
      dialedMasked: "+14092574186",
    });
    await history.addTurn(call.callId, {
      speaker: "caller",
      text: `caller marker ${call.marker}`,
    });
  }));

  for (const call of calls) {
    const stored = await state.getCall(call.callId);
    const record = await history.get(call.tenantId, call.callId);
    assert.equal(stored.marker, call.marker);
    assert.equal(stored.lastLead.service_type, `hvac_case_${call.marker}`);
    assert.equal(record.transcript.length, 1);
    assert.equal(record.transcript[0].text, `caller marker ${call.marker}`);
  }
});
