import test from "node:test";
import assert from "node:assert/strict";
import { TenantRegistry } from "../src/recovery/tenant-registry.js";
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
