import test from "node:test";
import assert from "node:assert/strict";
import { dispatchGate } from "../src/dispatch-gate.js";

test("outbound dispatch defaults fail closed", () => {
  const gate=dispatchGate({commercial:{}},{});
  assert.equal(gate.armed,false);
  assert.equal(gate.reason,"global_dispatch_disabled");
  assert.equal(gate.tenantMode,"shadow");
});

test("global arm alone cannot dispatch a shadow tenant", () => {
  const gate=dispatchGate({commercial:{dispatchMode:"shadow"}},{DISPATCH_ENABLED:"true"});
  assert.equal(gate.armed,false);
  assert.equal(gate.reason,"tenant_dispatch_not_live");
});

test("tenant live mode alone cannot dispatch without global arm", () => {
  const gate=dispatchGate({commercial:{dispatchMode:"live"}},{DISPATCH_ENABLED:"false"});
  assert.equal(gate.armed,false);
  assert.equal(gate.reason,"global_dispatch_disabled");
});

test("outbound dispatch requires both global arm and tenant live mode", () => {
  const gate=dispatchGate({commercial:{dispatchMode:"live"}},{DISPATCH_ENABLED:"TRUE"});
  assert.equal(gate.armed,true);
  assert.equal(gate.reason,null);
});
