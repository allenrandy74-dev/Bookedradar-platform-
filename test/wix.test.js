import test from "node:test";
import assert from "node:assert/strict";
import { createWixContact, createWixFollowupTask } from "../src/wix.js";

for (const lead of [
  { callback_number: "+14095550100", name: "Phone Test" },
  { email: "test@example.com" },
]) {
  test(`existing Wix contact is reused for ${lead.email ? "email" : "phone"} identity`, async (t) => {
    const requests = [];
    t.mock.method(globalThis, "fetch", async (url, options) => {
      requests.push({ url, options });
      return Response.json({ contacts: [{ id: "existing-contact" }] });
    });
    const result = await createWixContact({ apiKey: "test-key", siteId: "site-123", lead });
    assert.equal(result.contactId, "existing-contact");
    assert.equal(result.reused, true);
    assert.equal(requests.length, 1);
    const query = new URL(requests[0].url).searchParams;
    assert.equal(query.get(lead.email ? "email" : "phone"), lead.email || lead.callback_number);
    assert.equal(requests[0].options.method, undefined);
  });

  test(`new ${lead.email ? "email-only" : "phone"} lead creates a Wix contact after lookup`, async (t) => {
    const requests = [];
    t.mock.method(globalThis, "fetch", async (url, options) => {
      requests.push({ url, options });
      return Response.json(options.method === "POST" ? { contact: { id: "new-contact" } } : { contacts: [] });
    });
    const result = await createWixContact({ apiKey: "test-key", siteId: "site-123", lead });
    assert.equal(result.ok, true);
    assert.equal(result.contactId, "new-contact");
    assert.equal(requests.length, 2);
    const contact = JSON.parse(requests[1].options.body).contact;
    assert.equal(lead.email ? contact.email.email : contact.phone.phone, lead.email || lead.callback_number);
  });
}

test("failed Wix contact lookup does not create a duplicate", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests += 1;
    return Response.json({ error: "unauthorized" }, { status: 401 });
  });
  await assert.rejects(createWixContact({ apiKey: "test-key", siteId: "site-123", lead: { callback_number: "+14095550100" }, retries: 0 }), /401/);
  assert.equal(requests, 1);
});

test("Wix follow-up task is linked to the created contact", async () => {
  const originalFetch = globalThis.fetch;
  let captured = null;

  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return new Response(
      JSON.stringify({ task: { id: "task-123" } }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const result = await createWixFollowupTask({
      apiKey: "test-key",
      siteId: "site-123",
      contactId: "contact-123",
      lead: {
        name: "Taylor Test",
        callback_number: "+14095550100",
        service_type: "No cooling",
        call_id: "call-123",
      },
      dueInMinutes: 15,
    });

    assert.equal(result.ok, true);
    assert.equal(result.taskId, "task-123");
    assert.equal(captured.url, "https://www.wixapis.com/crm/tasks/v2/tasks");

    const body = JSON.parse(captured.options.body);
    assert.equal(body.task.status, "ACTION_NEEDED");
    assert.equal(body.task.contact.id, "contact-123");
    assert.match(body.task.title, /No cooling/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
