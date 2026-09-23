import test from "node:test";
import assert from "node:assert/strict";

import { normalizeLead, parseSipPhone } from "../src/operator.js";

test("extracts E.164 caller number from SIP From header", () => {
  assert.equal(
    parseSipPhone([
      { name: "From", value: "sip:+14095551212@sip.example.com" },
    ]),
    "+14095551212"
  );
});

test("uses network caller number as a fallback, not instead of confirmed number", () => {
  const fallback = normalizeLead(
    { service_type: "No cooling" },
    { call_id: "abc", caller_number: "+14095550000" }
  );
  assert.equal(fallback.callback_number, "+14095550000");

  const confirmed = normalizeLead(
    { service_type: "No cooling", callback_number: "+14095551111" },
    { call_id: "abc", caller_number: "+14095550000" }
  );
  assert.equal(confirmed.callback_number, "+14095551111");
});

test("truncates oversized notes", () => {
  const lead = normalizeLead(
    { service_type: "Plumbing", notes: "x".repeat(5000) },
    { call_id: "abc" }
  );
  assert.equal(lead.notes.length, 1200);
});

test("partial saves preserve earlier details and the caller's corrected callback", () => {
  const previous = normalizeLead({
    name: "Alex Smith", callback_number: "+14095551111",
    service_address: "123 Oak Lane", city: "Silsbee",
    service_type: "No cooling", urgency: "Urgent", notes: "Gate on left",
  }, { call_id: "abc" });
  const updated = normalizeLead({
    service_type: "No cooling", preferred_window: "Tomorrow morning",
    name: "  ", callback_number: "",
  }, { call_id: "abc", caller_number: "+14095550000", previous_lead: previous });
  for (const key of ["name", "callback_number", "service_address", "city", "urgency", "notes"]) {
    assert.equal(updated[key], previous[key], key);
  }
  assert.equal(updated.preferred_window, "Tomorrow morning");
});

test("later corrections replace previous details without carrying another call's identity", () => {
  const updated = normalizeLead({ name: "Alex Jones", city: "Beaumont", callback_number: "+14095552222", urgency: "Declined" }, {
    call_id: "current", previous_lead: { name: "Alex Smith", city: "Silsbee", callback_number: "+14095551111", urgency: "Urgent", call_id: "old" },
  });
  assert.equal(updated.name, "Alex Jones");
  assert.equal(updated.city, "Beaumont");
  assert.equal(updated.callback_number, "+14095552222");
  assert.equal(updated.urgency, "Declined");
  assert.equal(updated.call_id, "current");
});
