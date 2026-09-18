import test from "node:test";
import assert from "node:assert/strict";
import { createWixFollowupTask } from "../src/wix.js";

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
