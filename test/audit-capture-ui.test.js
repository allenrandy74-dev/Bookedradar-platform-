import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const script = await fs.readFile(new URL("../website/src/audit-capture.js", import.meta.url), "utf8");
function page({ answered = 7, response = async () => Response.json({ ok: true }) } = {}) {
  const values = { first: "Synthetic", last: "QA", company: "QA HVAC", email: "qa@example.com", contactPreference: "email", phone: "", trade: "HVAC", note: "QA only", company_url: "" };
  const fields = Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { value, listeners: {}, addEventListener(event, fn) { this.listeners[event] = fn; } }]));
  const button = { disabled: false };
  const form = { hidden: true, listeners: {}, elements: { namedItem: name => fields[name] }, querySelector: () => button, addEventListener(event, fn) { this.listeners[event] = fn; }, reportValidity() { return !fields.phone.required || Boolean(fields.phone.value); } };
  const nodes = { brAuditLeadForm: form, brAuditStatus: {}, 'audit-phone-field': {}, score: { textContent: '56' }, tier: { textContent: 'Meaningful recovery opportunity' }, money: { textContent: '$4,222' }, leads: { value: '10' }, job: { value: '650' }, rate: { value: '15' } };
  const answers = Array.from({ length: answered }, (_, index) => ({ closest(selector) { return selector === '.question' ? { querySelector: () => ({ textContent: `Question ${index + 1}` }) } : { textContent: `Answer ${index + 1}` }; } }));
  const requests = [];
  const telemetry = [];
  vm.runInNewContext(script, {
    document: { querySelector: () => ({ querySelector: () => ({}), appendChild() {} }), getElementById: id => nodes[id], createElement: () => ({}), querySelectorAll: () => answers },
    window: { BookedRadarTelemetry: { track: event => telemetry.push(event) } },
    fetch: async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); return response(); },
  });
  return { fields, nodes, form, requests, button, telemetry, choose(value) { fields.contactPreference.value = value; fields.contactPreference.listeners.change(); }, submit() { return form.listeners.submit({ preventDefault() {} }); } };
}

test("audit captures all answers with email-only follow-up through the confirmed backend", async () => {
  const p = page();
  p.fields.phone.value = '+14095550100';
  await p.submit();
  assert.equal(p.requests.length, 1);
  assert.match(p.requests[0].url, /public\/proof-pilot$/);
  assert.equal(p.requests[0].body.inquiryType, 'audit');
  assert.equal(p.requests[0].body.contactPreference, 'email');
  assert.equal('phone' in p.requests[0].body, false);
  for (let index = 1; index <= 7; index++) assert.ok(p.requests[0].body.auditReport.includes(`Question ${index} = Answer ${index}`));
  assert.match(p.requests[0].body.auditReport, /56 \/ 100/);
  assert.match(p.requests[0].body.auditReport, /Not a revenue guarantee/);
  assert.match(p.nodes.brAuditStatus.textContent, /answers are saved.*no sales call/);
  assert.deepEqual(p.telemetry, ['audit_submit']);
});

test("an incomplete audit sends nothing and preserves the contact details", async () => {
  const p = page({ answered: 6 });
  await p.submit();
  assert.equal(p.requests.length, 0);
  assert.equal(p.fields.company.value, 'QA HVAC');
  assert.match(p.nodes.brAuditStatus.textContent, /all 7/);
});

test("an audit phone choice requires a number and can return to email-only", async () => {
  const p = page();
  p.choose('phone');
  await p.submit();
  assert.equal(p.requests.length, 0);
  p.fields.phone.value = '+14095550100';
  await p.submit();
  assert.equal(p.requests[0].body.phone, '+14095550100');
  assert.match(p.nodes.brAuditStatus.textContent, /requested a phone call/);
  const email = page();
  email.choose('phone');
  email.fields.phone.value = '+14095550100';
  email.choose('email');
  assert.equal(email.fields.phone.disabled, true);
  await email.submit();
  assert.equal('phone' in email.requests[0].body, false);
});

test("failed and incomplete backend receipts retain answers and never report success", async () => {
  for (const response of [async () => Response.json({ ok: false }, { status: 503 }), async () => Response.json({}), async () => Response.json({ submission: { status: 'PENDING' } })]) {
    const p = page({ response });
    await p.submit();
    assert.match(p.nodes.brAuditStatus.textContent, /couldn’t confirm/);
    assert.equal(p.fields.company.value, 'QA HVAC');
    assert.equal(p.button.disabled, false);
    assert.deepEqual(p.telemetry, []);
  }
});

test("duplicates do not claim updated audit answers were saved", async () => {
  const p = page({ response: async () => Response.json({ ok: true, duplicate: true }) });
  await p.submit();
  assert.match(p.nodes.brAuditStatus.textContent, /already recorded.*update your answers/);
  assert.doesNotMatch(p.nodes.brAuditStatus.textContent, /answers are saved/);
  assert.deepEqual(p.telemetry, []);
  await p.submit();
  assert.equal(p.requests.length, 1);
});
