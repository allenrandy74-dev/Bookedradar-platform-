import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CallHistoryStore } from "../src/call-history.js";

test("voice health summary aggregates sanitized operational milestones", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "br-voice-health-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const history = new CallHistoryStore(path.join(dir, "calls.json"), { retentionDays: 30 });
  await history.load();

  const base = Date.now() - 10_000;
  for (let i = 0; i < 4; i++) {
    const callId = `call-${i}`;
    await history.start(callId, {
      tenantId: i < 3 ? "demo-hvac" : "demo-plumbing",
      callerMasked: "***TEST",
      dialedMasked: i < 3 ? "+14092574186" : "+14095477916",
    });
    // Stabilize timestamps for deterministic percentiles.
    history.data.calls[callId].startedAt = base + i * 100;
    await history.mark(callId, "call.accepted", { at: base + i * 100 + [50,100,150,200][i] });
    if (i !== 2) {
      await history.mark(callId, "greeting.first_audio", { at: base + i * 100 + [500,800,0,1200][i] });
    }
    if (i < 3) await history.mark(callId, "lead.persisted");
    if (i === 0 || i === 3) await history.mark(callId, "transfer.requested");
    if (i === 0) await history.mark(callId, "transfer.completed");
    if (i === 2) {
      await history.mark(callId, "greeting.failed");
      await history.mark(callId, "greeting.fallback", { reason: "legacy_human_transfer_requested" });
      await history.mark(callId, "realtime.error");
      await history.mark(callId, "realtime.error");
    }
    await history.finish(callId, i === 0 ? { transferred: true } : {});
  }

  const all = await history.operationalSummary({ sinceMs: base - 1 });
  assert.equal(all.callsStarted, 4);
  assert.equal(all.callsEnded, 4);
  assert.equal(all.callsAccepted, 4);
  assert.equal(all.callsWithFirstAudio, 3);
  assert.equal(all.callsEndedWithoutFirstAudio, 1);
  assert.equal(all.usefulLeadCalls, 3);
  assert.equal(all.transferRequests, 2);
  assert.equal(all.transfersCompleted, 1);
  assert.equal(all.greetingFailures, 1);
  assert.equal(all.greetingFallbacks, 1);
  assert.equal(all.realtimeErrors, 2);
  assert.deepEqual(all.byTenant, { "demo-hvac": 3, "demo-plumbing": 1 });
  assert.equal(all.latencyMs.acceptP50, 100);
  assert.equal(all.latencyMs.acceptP95, 200);
  assert.equal(all.latencyMs.firstAudioP50, 800);
  assert.equal(all.latencyMs.firstAudioP95, 1200);

  const hvac = await history.operationalSummary({ tenantId: "demo-hvac", sinceMs: base - 1 });
  assert.equal(hvac.callsStarted, 3);
  assert.equal(hvac.callsEndedWithoutFirstAudio, 1);
  assert.deepEqual(hvac.byTenant, { "demo-hvac": 3 });
});

test("milestones are call-isolated under concurrency", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "br-voice-health-concurrency-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const history = new CallHistoryStore(path.join(dir, "calls.json"), { retentionDays: 30 });
  await history.load();

  const calls = Array.from({ length: 60 }, (_, i) => ({
    id: `obs-${i}`,
    tenant: i % 2 ? "demo-hvac" : "demo-plumbing",
  }));

  await Promise.all(calls.map(c => history.start(c.id, { tenantId: c.tenant })));
  await Promise.all(calls.map((c, i) => history.mark(c.id, "call.accepted", { latencyMs: i + 1 })));
  await Promise.all(calls.map((c, i) => history.mark(c.id, "greeting.first_audio", { latencyMs: 100 + i })));

  for (let i = 0; i < calls.length; i++) {
    const call = await history.get(calls[i].tenant, calls[i].id);
    assert.equal(call.milestones["call.accepted"].latencyMs, i + 1);
    assert.equal(call.milestones["greeting.first_audio"].latencyMs, 100 + i);
  }
});
