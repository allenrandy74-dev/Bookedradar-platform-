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
