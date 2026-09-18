import test from "node:test";
import assert from "node:assert/strict";
import { validateTenant } from "../src/recovery/tenant.js";

test("tenant config requires escalation and booking mode", () => {
  const result = validateTenant({
    tenantId: "a",
    businessName: "A",
    trade: "HVAC",
    timeZone: "America/Chicago",
    serviceArea: ["X"],
    escalation: { humanPhone: "+14095550100" },
    policies: { bookingMode: "confirm_only" },
  });
  assert.equal(result.valid, true);
});
