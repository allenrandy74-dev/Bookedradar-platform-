import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSyntheticTwiml,
  runPrivateSyntheticVoice,
  validateSyntheticVoicePlan,
} from "../src/private-synthetic-voice.js";

const accountSid = "AC" + "a".repeat(32);
const authToken = "test-token";
const callerId = "+14095550100";
const privateTarget = {
  name: "Private HVAC",
  tenantId: "synthetic-hvac",
  to: "+14095550101",
  scenario: "My air conditioner stopped cooling and the house is getting hot.",
};

test("private synthetic voice refuses public demo targets", () => {
  const result = validateSyntheticVoicePlan({
    callerId,
    targets: [{ ...privateTarget, to: "+14092574186" }],
    forbiddenNumbers: ["+14092574186"],
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "public_demo_target_forbidden");
});

test("private synthetic voice requires synthetic tenant IDs and unique private numbers", () => {
  assert.equal(validateSyntheticVoicePlan({
    callerId,
    targets: [{ ...privateTarget, tenantId: "demo-hvac" }],
  }).error, "synthetic_tenant_id_required");

  assert.equal(validateSyntheticVoicePlan({
    callerId,
    targets: [privateTarget, { ...privateTarget }],
  }).error, "duplicate_synthetic_target");
});

test("private synthetic voice defaults to dry-run and makes no provider request", async () => {
  let requests = 0;
  const result = await runPrivateSyntheticVoice({
    accountSid,
    authToken,
    callerId,
    targets: [privateTarget],
    forbiddenNumbers: ["+14092574186"],
    fetchImpl: async () => { requests++; throw new Error("should_not_run"); },
  });
  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.callsCreated, 0);
  assert.equal(requests, 0);
});

test("private synthetic voice still dry-runs unless explicitly armed", async () => {
  let requests = 0;
  const result = await runPrivateSyntheticVoice({
    accountSid,
    authToken,
    callerId,
    targets: [privateTarget],
    armed: false,
    dryRun: false,
    fetchImpl: async () => { requests++; throw new Error("should_not_run"); },
  });
  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(requests, 0);
});

test("armed private synthetic voice creates bounded provider calls and returns SIDs", async () => {
  const bodies = [];
  const target2 = {
    name: "Private Plumbing",
    tenantId: "synthetic-plumbing",
    to: "+14095550102",
    scenario: "Water is coming through the ceiling and I need help.",
  };
  let counter = 0;
  const result = await runPrivateSyntheticVoice({
    accountSid,
    authToken,
    callerId,
    targets: [privateTarget, target2],
    armed: true,
    dryRun: false,
    fetchImpl: async (_url, options) => {
      bodies.push(String(options.body));
      counter++;
      return {
        ok: true,
        status: 201,
        async text() {
          return JSON.stringify({
            sid: "CA" + String(counter).padStart(32, "a"),
            status: "queued",
          });
        },
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.callsCreated, 2);
  assert.equal(bodies.length, 2);
  assert.match(decodeURIComponent(bodies[0]), /My air conditioner stopped cooling/);
});

test("synthetic TwiML escapes untrusted scenario text", () => {
  const xml = buildSyntheticTwiml({ scenario: 'Leak <urgent> & "fast"' });
  assert.match(xml, /&lt;urgent&gt;/);
  assert.match(xml, /&amp;/);
  assert.match(xml, /&quot;fast&quot;/);
  assert.doesNotMatch(xml, /<urgent>/);
});

test("private synthetic target count is capped", () => {
  const targets = Array.from({ length: 11 }, (_, i) => ({
    ...privateTarget,
    to: `+1409555${String(1000 + i).padStart(4, "0")}`,
    tenantId: `synthetic-test-${i}`,
  }));
  const result = validateSyntheticVoicePlan({ callerId, targets, maxTargets: 10 });
  assert.equal(result.ok, false);
  assert.equal(result.error, "synthetic_target_limit_exceeded");
});
