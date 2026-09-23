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
      phone: { enabled: true, inboundNumbers: [number] },
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


test("unknown dialed number never falls back to the only business", () => {
  const registry = new TenantRegistry([tenant("pilot", "+14095550101")]);
  assert.equal(registry.resolve({ phone: "+14095550999" }), null);
  assert.equal(registry.resolveByPhone(""), null);
  assert.equal(registry.resolveByPhone("invalid"), null);
  assert.equal(registry.resolveByPhone("+1 (409) 555-0101").tenantId, "pilot");
  // Administrative selection without a dialed number keeps its legacy default.
  assert.equal(registry.resolve({}).tenantId, "pilot");
});

test("disabled and unactivated phone routes cannot receive calls", () => {
  for (const enabled of [false, undefined]) {
    const t = tenant("pilot", "+14095550101"); t.integrations.phone.enabled = enabled;
    const registry = new TenantRegistry([t]);
    assert.equal(registry.resolveByPhone("+14095550101"), null);
    assert.equal(registry.resolve({ phone: "+14095550101" }), null);
    assert.equal(registry.get("pilot"), t);
  }
});

test("two enabled businesses resolve only their assigned numbers", () => {
  const a = tenant("a", "+14095550101"), b = tenant("b", "+14095550102");
  const registry = new TenantRegistry([a, b]);
  assert.equal(registry.resolveByPhone("+14095550101"), a);
  assert.equal(registry.resolveByPhone("+14095550102"), b);
  assert.equal(registry.resolveByPhone("+14095550999"), null);
  assert.throws(() => new TenantRegistry([a, tenant("c", "+14095550101")]), /multiple tenants/);
});
