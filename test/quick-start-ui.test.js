import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const script = await fs.readFile(new URL("../website/src/quick-start.js", import.meta.url), "utf8");
function page({ fail = false } = {}) {
  const values = {
    first_name: "Synthetic", business_name: "QA HVAC", email: "qa@example.com",
    contact_preference: "email", phone: "", business_type: "HVAC",
    service_area: "Beaumont", business_hours: "Mon-Fri 8-5", services: "Repair",
    coverage: "After hours", urgent_contact: "Operator 409-555-0100",
    urgent_definition: "", customer_tracking: "", booking: "", anything_else: "QA only",
    website_check: ""
  };
  const elements = Object.fromEntries(Object.entries(values).map(([name, value]) => [name, {
    value, disabled: false, required: false, listeners: {},
    addEventListener(event, fn) { this.listeners[event] = fn; }
  }]));
  const button = { disabled: false };
  const form = {
    elements, hidden: false, listeners: {}, reset() {},
    addEventListener(event, fn) { this.listeners[event] = fn; },
    reportValidity() { return !elements.phone.required || Boolean(elements.phone.value); },
    querySelector() { return button; }
  };
  const nodes = { quickStart: form, setupStatus: {}, nextSteps: { hidden: true }, 'setup-phone-field': {}, 'setup-followup': {} };
  const requests = [];
  vm.runInNewContext(script, {
    document: { getElementById(id) { return nodes[id]; } },
    fetch: async (url, options) => {
      const body = JSON.parse(options.body);
      requests.push({ url, body });
      if (url.includes('oauth2')) return Response.json({ access_token: 'test-only' });
      return fail ? Response.json({}, { status: 503 }) : Response.json({ submission: { id: 'qa-submission' } });
    }
  });
  return {
    elements, nodes, requests, button,
    choose(value) { elements.contact_preference.value = value; elements.contact_preference.listeners.change(); },
    submit() { return form.listeners.submit({ preventDefault() {} }); }
  };
}

test("email-only setup suppresses a stale setup phone while retaining the separate escalation destination", async () => {
  const p = page();
  p.elements.phone.value = "+14095550199";
  await p.submit();
  const submitted = p.requests[1].body.submission.submissions;
  assert.equal(submitted.contact_preference, "email");
  assert.equal("phone" in submitted, false);
  assert.equal(submitted.urgent_contact, "Operator 409-555-0100");
  assert.match(submitted.anything_else, /EMAIL ONLY.*do not make setup or sales calls/);
  assert.match(p.nodes['setup-followup'].textContent, /by email/);
});

test("a requested setup call requires its own number and persists the explicit phone choice", async () => {
  const p = page();
  p.choose("phone");
  await p.submit();
  assert.equal(p.requests.length, 0);
  p.elements.phone.value = "+14095550199";
  await p.submit();
  const submitted = p.requests[1].body.submission.submissions;
  assert.equal(submitted.contact_preference, "phone");
  assert.equal(submitted.phone, "+14095550199");
  assert.match(p.nodes['setup-followup'].textContent, /requested a setup call/);
});

test("switching back to email-only removes the setup phone requirement", () => {
  const p = page();
  p.choose("phone");
  p.choose("email");
  assert.equal(p.elements.phone.required, false);
  assert.equal(p.elements.phone.disabled, true);
  assert.equal(p.nodes['setup-phone-field'].hidden, true);
});

test("an unconfirmed setup submission retains answers for correction", async () => {
  const p = page({ fail: true });
  await p.submit();
  assert.equal(p.nodes.quickStart.hidden, false);
  assert.equal(p.nodes.nextSteps.hidden, true);
  assert.equal(p.button.disabled, false);
  assert.equal(p.elements.business_name.value, "QA HVAC");
});
