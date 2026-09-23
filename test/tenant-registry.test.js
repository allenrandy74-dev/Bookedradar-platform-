import test from "node:test";
import assert from "node:assert/strict";
import { TenantRegistry, humanTransferTarget } from "../src/recovery/tenant-registry.js";
import { parseDialedNumber } from "../src/operator.js";

function tenant(id, number) {
  return {
    tenantId: id,
    businessName: id,
    trade: "HVAC",
    timeZone: "America/Chicago",
    serviceArea: ["X"],
    escalation: { humanPhone: "+14095550000" },
    policies: { bookingMode: "confirm_only" },
    integrations: {
      phone: { inboundNumbers: [number] },
    },
  };
}

test("registry routes dialed phone number to the correct tenant", () => {
  const registry = new TenantRegistry([
    tenant("a", "+14095550101"),
    tenant("b", "+14095550102"),
  ]);
  assert.equal(registry.resolve({ phone: "+14095550102" }).tenantId, "b");
});

test("dialed number prefers Diversion header and parses E.164", () => {
  const value = parseDialedNumber([
    { name: "To", value: "<sip:+14095559999@example.com>" },
    { name: "Diversion", value: "<sip:+14095550101@twilio.com>" },
  ]);
  assert.equal(value, "+14095550101");
});

test("human transfer selects each business target and never a global target", () => {
  const a = tenant("a", "+14095550101"); a.secretsPrefix = "A";
  const b = tenant("b", "+14095550102"); b.escalation.humanPhone = "+14095550199";
  const env = { HUMAN_TRANSFER_NUMBER: "+14095550198", A_HUMAN_TRANSFER_NUMBER: "+14095550197" };
  assert.equal(humanTransferTarget(a, env), "+14095550197");
  assert.equal(humanTransferTarget(b, env), "+14095550199");
  assert.equal(humanTransferTarget({ escalation: {} }, env), "");
  assert.equal(humanTransferTarget(a, { ...env, A_HUMAN_TRANSFER_NUMBER: "invalid" }), "");
});
