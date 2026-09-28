const STATUSES = new Set([
  "new",
  "acknowledged",
  "investigating",
  "mitigated",
  "monitoring",
  "resolved",
  "closed",
]);

const SEVERITIES = new Set(["SEV-1", "SEV-2", "SEV-3", "REQUEST"]);
const SOURCES = new Set(["customer", "monitoring", "provider", "internal"]);

const PROHIBITED_EXACT_KEYS = new Set([
  "password",
  "secret",
  "token",
  "credential",
  "transcript",
  "recording",
  "callerphone",
  "callername",
  "serviceaddress",
  "payment",
  "cardnumber",
  "paymentcardnumber",
  "ssn",
  "socialsecurity",
]);

function prohibitedSupportKey(key) {
  const normalized = String(key || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (PROHIBITED_EXACT_KEYS.has(normalized)) return true;
  return (
    /(?:password|secret|token|credential)$/.test(normalized) ||
    /^(?:transcript|recording)/.test(normalized) ||
    /^caller(?:phone|name)/.test(normalized) ||
    /^serviceaddress/.test(normalized) ||
    /^(?:payment|cardnumber|paymentcardnumber)/.test(normalized) ||
    /^(?:ssn|socialsecurity)/.test(normalized)
  );
}

function clean(value, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

export function redactSupportText(value, max = 2000) {
  return clean(value, max)
    .replace(/\b\d{3}[- ]?\d{2}[- ]?\d{4}\b/g, "[REDACTED_SSN]")
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, "[REDACTED_PAYMENT_NUMBER]")
    .replace(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/g, "[REDACTED_PHONE]")
    .replace(/\b(?:sk-proj-|sk_live_|sk_test_|whsec_)[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_SECRET]")
    .replace(/\bBearer\s+[A-Za-z0-9._~-]{12,}\b/gi, "Bearer [REDACTED_SECRET]");
}

function normalizeIso(value) {
  const raw = clean(value, 80);
  if (!raw) return "";
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
}

function safeEvidenceIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map(item => clean(item, 180))
    .filter(item => /^[A-Za-z0-9_.:@/-]+$/.test(item))
  )].slice(0, 20);
}

function safeUrl(value) {
  const raw = clean(value, 500);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export function normalizeSupportCase(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "support_case_object_required" };
  }

  const prohibited = Object.keys(input).find(prohibitedSupportKey);
  if (prohibited) {
    return {
      ok: false,
      error: "prohibited_support_case_field",
      field: prohibited,
    };
  }

  const severity = clean(input.severity, 20).toUpperCase();
  const status = clean(input.status, 40).toLowerCase();
  const source = clean(input.source, 40).toLowerCase();

  if (!SEVERITIES.has(severity)) {
    return { ok: false, error: "invalid_support_case_severity" };
  }
  if (!STATUSES.has(status)) {
    return { ok: false, error: "invalid_support_case_status" };
  }
  if (!SOURCES.has(source)) {
    return { ok: false, error: "invalid_support_case_source" };
  }

  const title = redactSupportText(input.title, 240);
  const tenantId = clean(input.tenantId, 120);
  const impact = redactSupportText(input.impact, 2000);
  if (!title || !tenantId || !impact) {
    return { ok: false, error: "support_case_required_fields_missing" };
  }

  return {
    ok: true,
    case: {
      title,
      tenantId,
      businessName: redactSupportText(input.businessName, 200),
      severity,
      status,
      source,
      impact,
      owner: clean(input.owner, 160),
      firstObserved: normalizeIso(input.firstObserved) || new Date().toISOString(),
      nextAction: redactSupportText(input.nextAction, 2000),
      nextUpdateAt: normalizeIso(input.nextUpdateAt),
      safeEvidenceIds: safeEvidenceIds(input.safeEvidenceIds),
      workaround: redactSupportText(input.workaround, 2000),
      resolution: redactSupportText(input.resolution, 2000),
      engineeringIssueUrl: safeUrl(input.engineeringIssueUrl),
      repeatOf: clean(input.repeatOf, 180),
      lastCustomerUpdateAt: normalizeIso(input.lastCustomerUpdateAt),
      closedAt: normalizeIso(input.closedAt),
    },
  };
}
