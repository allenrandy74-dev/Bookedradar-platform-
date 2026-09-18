import test from "node:test";
import assert from "node:assert/strict";
import { normalizeIntake, isOptOutText } from "../src/intake.js";

test("dedicated estimate intake preserves estimate amount", () => {
  const event = normalizeIntake("estimate", {
    externalId: "est-1", email: "a@example.com", estimateAmount: 12345, serviceType: "replacement",
  });
  assert.equal(event.type, "estimate_sent");
  assert.equal(event.estimateAmount, 12345);
  assert.match(event.idempotencyKey, /^estimate:/);
});

test("STOP variants are recognized as opt-outs", () => {
  assert.equal(isOptOutText(" STOP "), true);
  assert.equal(isOptOutText("please stop"), false);
});
