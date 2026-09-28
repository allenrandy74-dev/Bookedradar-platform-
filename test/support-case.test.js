import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSupportCase, redactSupportText } from "../src/support-case.js";

test("support case normalizes only approved operational metadata", () => {
  const result = normalizeSupportCase({
    title: "HVAC transfer investigation",
    tenantId: "demo-hvac",
    businessName: "Example HVAC",
    severity: "sev-2",
    status: "investigating",
    source: "monitoring",
    impact: "Human transfer did not initiate on two calls.",
    owner: "primary-operator",
    firstObserved: "2026-09-28T20:00:00-05:00",
    nextAction: "Review safe call IDs and transfer events.",
    safeEvidenceIds: ["call_123", "provider:abc-123", "call_123"],
    engineeringIssueUrl: "https://github.com/allenrandy74-dev/Bookedradar-platform-/issues/21",
  });
  assert.equal(result.ok, true);
  assert.equal(result.case.severity, "SEV-2");
  assert.equal(result.case.status, "investigating");
  assert.equal(result.case.source, "monitoring");
  assert.deepEqual(result.case.safeEvidenceIds, ["call_123", "provider:abc-123"]);
  assert.equal(result.case.firstObserved, "2026-09-29T01:00:00.000Z");
  assert.match(result.case.engineeringIssueUrl, /^https:\/\/github\.com\//);
});

test("support case rejects explicitly prohibited sensitive fields", () => {
  for (const field of [
    "callerPhone",
    "caller_name",
    "serviceAddress",
    "transcript",
    "recordingUrl",
    "apiToken",
    "password",
    "paymentCardNumber",
  ]) {
    const result = normalizeSupportCase({
      title: "Case",
      tenantId: "tenant",
      severity: "SEV-3",
      status: "new",
      source: "internal",
      impact: "Test impact",
      [field]: "sensitive",
    });
    assert.equal(result.ok, false, field);
    assert.equal(result.error, "prohibited_support_case_field", field);
    assert.equal(result.field, field);
  }
});

test("support text redacts common sensitive values", () => {
  const text = redactSupportText(
    "Caller +1 (409) 555-1212 gave SSN 123-45-6789 and token sk-proj-abcdefghijklmnopqrstuvwxyz and Bearer abc.def.ghi-JKLmnop"
  );
  assert.doesNotMatch(text, /409/);
  assert.doesNotMatch(text, /123-45-6789/);
  assert.doesNotMatch(text, /sk-proj-/);
  assert.doesNotMatch(text, /abc\.def/);
  assert.match(text, /REDACTED_PHONE/);
  assert.match(text, /REDACTED_SSN/);
  assert.match(text, /REDACTED_SECRET/);
});

test("support case refuses invalid enum values and missing core fields", () => {
  assert.equal(normalizeSupportCase({
    title: "Case", tenantId: "t", impact: "x",
    severity: "urgent", status: "new", source: "internal",
  }).error, "invalid_support_case_severity");

  assert.equal(normalizeSupportCase({
    title: "Case", tenantId: "t", impact: "x",
    severity: "SEV-2", status: "waiting", source: "internal",
  }).error, "invalid_support_case_status");

  assert.equal(normalizeSupportCase({
    title: "Case", tenantId: "t", impact: "x",
    severity: "SEV-2", status: "new", source: "email",
  }).error, "invalid_support_case_source");

  assert.equal(normalizeSupportCase({
    title: "", tenantId: "t", impact: "x",
    severity: "SEV-2", status: "new", source: "internal",
  }).error, "support_case_required_fields_missing");
});

test("support case drops unsafe evidence IDs and non-https engineering URLs", () => {
  const result = normalizeSupportCase({
    title: "Case",
    tenantId: "tenant",
    severity: "REQUEST",
    status: "new",
    source: "customer",
    impact: "Configuration request.",
    safeEvidenceIds: ["call_ok-123", "contains spaces", "secret?x=1"],
    engineeringIssueUrl: "http://example.com/issue",
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.case.safeEvidenceIds, ["call_ok-123"]);
  assert.equal(result.case.engineeringIssueUrl, "");
});
