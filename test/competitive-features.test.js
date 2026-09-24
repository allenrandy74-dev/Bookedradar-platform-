import test from "node:test";
import assert from "node:assert/strict";
import {
  competitiveFeaturesForTenant,
  competitiveFeatureGuidance,
  inputTranscriptionForTenant,
  returningCallerContext,
  toolsForTenant,
} from "../src/competitive-features.js";

test("competitive features are off by default without changing the proven call path", () => {
  const features = competitiveFeaturesForTenant({});
  assert.deepEqual(features, {
    callerMemory: false,
    spamScreening: false,
    transcriptHistory: false,
    languages: ["en"],
  });
  assert.equal(inputTranscriptionForTenant({}), null);
  assert.equal(toolsForTenant([{ name: "capture_lead" }], {}).length, 1);
});

test("Spanish, transcript history and spam screening are opt-in tenant features", () => {
  const tenant = { features: { languages: ["en", "es", "xx"], transcriptHistory: true, spamScreening: true } };
  assert.deepEqual(competitiveFeaturesForTenant(tenant).languages, ["en", "es"]);
  assert.deepEqual(inputTranscriptionForTenant(tenant), {
    model: "gpt-live-transcribe",
    languages: ["en", "es"],
    delay: "low",
  });
  assert.equal(toolsForTenant([{ name: "capture_lead" }], tenant).at(-1).name, "end_call");
  const guidance = competitiveFeatureGuidance(tenant);
  assert.match(guidance, /English and Spanish/);
  assert.match(guidance, /SPAM \/ SOLICITOR/);
  assert.match(guidance, /TRANSCRIPT HISTORY/);
});

test("returning caller memory is private, tenant-isolated and caller-ID cautious", async () => {
  const tenant = { tenantId: "a", features: { callerMemory: true } };
  const store = {
    getContact: async key => key === "a:+14095550100" ? { name: "Alex Smith" } : null,
    snapshot: async () => ({
      opportunities: {
        one: { tenantId: "a", contactKey: "a:+14095550100", serviceType: "AC repair", updatedAt: "2026-09-24T12:00:00Z" },
        other: { tenantId: "b", contactKey: "b:+14095550100", serviceType: "Plumbing", updatedAt: "2026-09-24T13:00:00Z" },
      },
    }),
  };
  const memory = await returningCallerContext({ store, tenant, callerNumber: "+14095550100" });
  assert.match(memory, /Alex Smith/);
  assert.match(memory, /AC repair/);
  assert.doesNotMatch(memory, /Plumbing/);
  assert.match(memory, /not identity proof/i);
});
