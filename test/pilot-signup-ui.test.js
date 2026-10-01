import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const script = await fs.readFile(new URL("../public/pilot-signup.js", import.meta.url), "utf8");
function page(response = async () => Response.json({ ok: true })) {
  const fields = new Map();
  for (const id of ["pilot-request", "contact-preference", "phone-field", "phone", "submit-request", "status", "success", "confirmation"]) {
    fields.set(id, { value: "", hidden: false, disabled: false, required: false, textContent: "", listeners: {}, addEventListener(name, fn) { this.listeners[name] = fn; }, focus() { this.focused = true; } });
  }
  fields.get("contact-preference").value = "email";
  fields.get("success").hidden = true;
  const heading = { textContent: "Request received." };
  fields.get("success").querySelector = () => heading;
  fields.get("pilot-request").reportValidity = () => true;
  const requests = [];
  class FormData {
    entries() {
      const data = { name: "Synthetic", business: "Synthetic HVAC", email: "synthetic@example.com", contactPreference: fields.get("contact-preference").value };
      if (!fields.get("phone").disabled) data.phone = fields.get("phone").value;
      return Object.entries(data);
    }
  }
  vm.runInNewContext(script, { document: { getElementById: id => fields.get(id) }, FormData, fetch: async (_url, options) => { requests.push(JSON.parse(options.body)); return response(); } });
  return { fields, heading, requests, choose(value) { fields.get("contact-preference").value = value; fields.get("contact-preference").listeners.change(); }, submit() { return fields.get("pilot-request").listeners.submit({ preventDefault() {} }); } };
}

test("online signup submits email-only without a hidden phone and focuses confirmation", async () => {
  const p = page();
  assert.equal(p.fields.get("phone-field").hidden, true);
  await p.submit();
  assert.equal(p.requests[0].contactPreference, "email");
  assert.equal("phone" in p.requests[0], false);
  assert.match(p.fields.get("confirmation").textContent, /no sales call/);
  assert.equal(p.fields.get("pilot-request").hidden, true);
  assert.equal(p.fields.get("success").focused, true);
});

test("a requested call requires a number; returning to email suppresses it", async () => {
  const p = page();
  p.choose("phone");
  assert.equal(p.fields.get("phone").required, true);
  p.fields.get("phone").value = "+14095550100";
  p.choose("email");
  assert.equal(p.fields.get("phone").required, false);
  await p.submit();
  assert.equal("phone" in p.requests[0], false);
});

test("phone choice reaches the submitted request and matching confirmation", async () => {
  const p = page();
  p.choose("phone");
  p.fields.get("phone").value = "+14095550100";
  await p.submit();
  assert.equal(p.requests[0].phone, "+14095550100");
  assert.match(p.fields.get("confirmation").textContent, /asked for a phone call/);
});

test("an unconfirmed submission keeps the form and enables correction", async () => {
  const p = page(async () => Response.json({ ok: false }, { status: 503 }));
  await p.submit();
  assert.equal(p.fields.get("success").hidden, true);
  assert.equal(p.fields.get("pilot-request").hidden, false);
  assert.equal(p.fields.get("submit-request").disabled, false);
  assert.match(p.fields.get("status").textContent, /details are still here/);
});

test("duplicate submission does not claim a changed contact preference was saved", async () => {
  const p = page(async () => Response.json({ ok: true, duplicate: true }));
  await p.submit();
  assert.match(p.heading.textContent, /already recorded/);
  assert.match(p.fields.get("confirmation").textContent, /confirm its status/);
  assert.doesNotMatch(p.fields.get("confirmation").textContent, /You chose/);
});

test("repeated button presses send only one in-flight request", async () => {
  let finish;
  const p = page(() => new Promise(resolve => { finish = resolve; }));
  const first = p.submit();
  await p.submit();
  assert.equal(p.requests.length, 1);
  finish(Response.json({ ok: true }));
  await first;
});


test("pending409 preserves signup details and gives email reconciliation fallback", async () => {
  const p = page(async () => Response.json({ ok: false, error: "inquiry_capture_unconfirmed" }, { status: 409 }));
  p.choose("phone"); p.fields.get("phone").value = "+14095550100";
  await p.submit();
  assert.equal(p.fields.get("phone").value, "+14095550100");
  assert.equal(p.fields.get("pilot-request").hidden, false);
  assert.equal(p.fields.get("success").hidden, true);
  assert.equal(p.fields.get("submit-request").disabled, false);
  assert.match(p.fields.get("status").textContent, /randy@bookedradar.com.*don’t submit repeatedly/);
});
