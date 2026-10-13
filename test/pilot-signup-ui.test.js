import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const script = await fs.readFile(new URL("../public/pilot-signup.js", import.meta.url), "utf8");
function page(response = async () => Response.json({ ok: true }), timers = { setTimeout, clearTimeout }) {
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
  vm.runInNewContext(script, { AbortController, ...timers, document: { getElementById: id => fields.get(id) }, FormData, fetch: async (_url, options) => { requests.push(JSON.parse(options.body)); return response(options); } });
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

test("an unconfirmed submission keeps the form and pauses resubmission for reconciliation", async () => {
  const p = page(async () => Response.json({ ok: false }, { status: 503 }));
  await p.submit();
  assert.equal(p.fields.get("success").hidden, true);
  assert.equal(p.fields.get("pilot-request").hidden, false);
  assert.equal(p.fields.get("submit-request").disabled, true);
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
  assert.equal(p.fields.get("submit-request").disabled, true);
  assert.match(p.fields.get("status").textContent, /randy@bookedradar.com.*don’t submit repeatedly/);
});


function manualTimers() {
  let expire;
  let cleared = 0;
  return {
    setTimeout(fn, ms) { assert.equal(ms, 20000); expire = fn; return 1; },
    clearTimeout(id) { assert.equal(id, 1); cleared++; },
    expire() { expire(); },
    get cleared() { return cleared; },
  };
}

for (const stage of ["fetch", "body"]) {
  test(`a stalled ${stage} stops pending, preserves values and blocks manual retry while receipt is uncertain`, async () => {
    const timers = manualTimers();
    let signal;
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    const p = page(options => {
      signal = options.signal;
      return stage === "fetch" ? pending : { ok: true, json: () => pending };
    }, timers);
    p.choose("phone");
    p.fields.get("phone").value = "+14095550100";
    const submitting = p.submit();
    await Promise.resolve();
    assert.equal(p.fields.get("submit-request").disabled, true);
    timers.expire();
    await submitting;
    assert.equal(signal.aborted, true);
    assert.equal(timers.cleared, 1);
    assert.equal(p.requests.length, 1);
    assert.equal(p.fields.get("phone").value, "+14095550100");
    assert.equal(p.fields.get("submit-request").disabled, true);
    assert.equal(p.fields.get("submit-request").textContent, "Contact us to confirm");
    assert.match(p.fields.get("status").textContent, /may have been received/);
    assert.match(p.fields.get("status").textContent, /don’t submit repeatedly/);
    // A second submit event (including Enter) cannot start a second write.
    await p.submit();
    assert.equal(p.requests.length, 1);
    // Editing contact details must not bypass the hold on an uncertain request.
    p.choose("email");
    await p.submit();
    assert.equal(p.requests.length, 1);
    assert.match(p.fields.get("status").textContent, /Online resubmission is paused/);
    // Even a transport that ignores abort cannot overwrite the uncertain state.
    finish(stage === "fetch" ? Response.json({ ok: true }) : { ok: true });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(p.fields.get("success").hidden, true);
    assert.equal(p.fields.get("pilot-request").hidden, false);
    assert.equal(p.requests.length, 1);
  });
}

for (const outcome of ["success", "invalid-json", "network-failure"]) {
  test(`${outcome} clears the deadline without an automatic retry`, async () => {
    const timers = manualTimers();
    const p = page(async () => {
      if (outcome === "network-failure") throw new TypeError("offline");
      return outcome === "success" ? Response.json({ ok: true }) : new Response("not JSON");
    }, timers);
    await p.submit();
    assert.equal(timers.cleared, 1);
    assert.equal(p.requests.length, 1);
    assert.equal(p.fields.get("submit-request").disabled, outcome !== "success");
    assert.equal(p.fields.get("success").hidden, outcome !== "success");
    if (outcome !== "success") {
      await p.submit();
      assert.equal(p.requests.length, 1);
    }
  });
}


test("late rejection after timeout preserves reconciliation hold and cannot trigger manual retry", async () => {
  const timers = manualTimers();
  let rejectRequest;
  const p = page(() => new Promise((_, reject) => { rejectRequest = reject; }), timers);
  const submitting = p.submit();
  timers.expire();
  await submitting;
  const message = p.fields.get("status").textContent;
  rejectRequest(new TypeError("late connection failure"));
  await new Promise(resolve => setImmediate(resolve));
  await p.submit();
  assert.equal(p.requests.length, 1);
  assert.equal(p.fields.get("status").textContent, message);
  assert.equal(p.fields.get("submit-request").disabled, true);
  assert.equal(p.fields.get("success").hidden, true);
});
