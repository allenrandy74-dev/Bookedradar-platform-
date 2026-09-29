const PHONE_RE = /^\+[1-9]\d{7,14}$/;
const SID_RE = /^CA[0-9a-f]{32}$/i;
const MAX_TARGETS = 10;
const CALL_TIME_LIMIT_SECONDS = 60;

function escapeXml(value = "") {
  return String(value).replace(/[<>&"']/g, ch => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    '"': "&quot;",
    "'": "&apos;",
  })[ch]);
}

export function buildSyntheticTwiml({
  scenario,
  initialPauseSeconds = 5,
  listenSeconds = 18,
} = {}) {
  const phrase = String(scenario || "").trim().slice(0, 800);
  if (!phrase) throw new Error("synthetic_scenario_required");
  const initial = Math.min(Math.max(Number(initialPauseSeconds) || 5, 1), 15);
  const listen = Math.min(Math.max(Number(listenSeconds) || 18, 5), 60);
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Pause length="${initial}"/><Say>${escapeXml(phrase)}</Say><Pause length="${listen}"/><Hangup/></Response>`;
}

export function validateSyntheticVoicePlan({
  callerId,
  targets = [],
  forbiddenNumbers = [],
  maxTargets = 10,
} = {}) {
  if (!Number.isInteger(maxTargets) || maxTargets < 1 || maxTargets > MAX_TARGETS) {
    return { ok: false, error: "synthetic_target_limit_invalid" };
  }
  if (!Array.isArray(forbiddenNumbers) || !forbiddenNumbers.length ||
      forbiddenNumbers.some(number => typeof number !== "string" || !PHONE_RE.test(number))) {
    return { ok: false, error: "public_demo_exclusion_list_required" };
  }
  if (!PHONE_RE.test(String(callerId || ""))) {
    return { ok: false, error: "synthetic_caller_id_invalid" };
  }
  if (!Array.isArray(targets) || !targets.length) {
    return { ok: false, error: "synthetic_targets_required" };
  }
  if (targets.length > maxTargets) {
    return { ok: false, error: "synthetic_target_limit_exceeded" };
  }

  const forbidden = new Set((forbiddenNumbers || []).map(String));
  if (forbidden.has(callerId)) {
    return { ok: false, error: "public_demo_caller_id_forbidden" };
  }
  const seen = new Set();

  for (const target of targets) {
    const to = String(target?.to || "");
    const tenantId = String(target?.tenantId || "");
    const scenario = String(target?.scenario || "").trim();

    if (!PHONE_RE.test(to)) return { ok: false, error: "synthetic_target_invalid", target: to };
    if (forbidden.has(to)) return { ok: false, error: "public_demo_target_forbidden", target: to };
    if (to === callerId) return { ok: false, error: "synthetic_target_matches_caller_id", target: to };
    if (seen.has(to)) return { ok: false, error: "duplicate_synthetic_target", target: to };
    if (!/^synthetic-[a-z0-9-]+$/i.test(tenantId)) {
      return { ok: false, error: "synthetic_tenant_id_required", target: to };
    }
    if (!scenario) return { ok: false, error: "synthetic_scenario_required", target: to };
    seen.add(to);
  }

  return { ok: true };
}

async function createTwilioCall({
  accountSid,
  authToken,
  callerId,
  target,
  fetchImpl,
  timeoutMs,
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetchImpl(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Calls.json`,
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: target.to,
          From: callerId,
          TimeLimit: String(CALL_TIME_LIMIT_SECONDS),
          Timeout: "15",
          Twiml: buildSyntheticTwiml({
            scenario: target.scenario,
            initialPauseSeconds: target.initialPauseSeconds,
            listenSeconds: target.listenSeconds,
          }),
        }),
      }
    );
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {}
    if (!response.ok || !SID_RE.test(data?.sid || "")) {
      const error = new Error("synthetic_twilio_call_failed");
      error.status = response.status;
      error.detail = data?.message || data?.code || "provider_error";
      throw error;
    }
    return {
      ok: true,
      sid: data.sid,
      status: data.status || null,
      to: target.to,
      tenantId: target.tenantId,
      name: target.name || target.tenantId,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function runPrivateSyntheticVoice({
  accountSid,
  authToken,
  callerId,
  targets,
  forbiddenNumbers = [],
  armed = false,
  dryRun = true,
  maxTargets = 10,
  fetchImpl = fetch,
  timeoutMs = 10000,
} = {}) {
  const validation = validateSyntheticVoicePlan({
    callerId,
    targets,
    forbiddenNumbers,
    maxTargets,
  });
  if (!validation.ok) return validation;

  if (!/^AC[0-9a-f]{32}$/i.test(String(accountSid || "")) || !authToken) {
    return { ok: false, error: "twilio_credentials_missing" };
  }

  const plan = targets.map(target => ({
    name: target.name || target.tenantId,
    tenantId: target.tenantId,
    to: target.to,
    scenario: String(target.scenario).slice(0, 800),
  }));

  if (dryRun !== false || armed !== true) {
    return {
      ok: true,
      dryRun: true,
      armed: Boolean(armed),
      callsCreated: 0,
      plan,
      callTimeLimitSeconds: CALL_TIME_LIMIT_SECONDS,
    };
  }

  const settled = await Promise.allSettled(
    targets.map(target => createTwilioCall({
      accountSid,
      authToken,
      callerId,
      target,
      fetchImpl,
      timeoutMs,
    }))
  );

  const results = settled.map((item, index) => item.status === "fulfilled"
    ? item.value
    : {
        ok: false,
        to: targets[index].to,
        tenantId: targets[index].tenantId,
        name: targets[index].name || targets[index].tenantId,
        error: String(item.reason?.message || "synthetic_call_failed"),
        providerStatus: item.reason?.status || null,
      });

  return {
    ok: results.every(item => item.ok),
    dryRun: false,
    armed: true,
    callsCreated: results.filter(item => item.ok).length,
    // Creation/queue acceptance is not evidence of answered or overlapping calls.
    evidenceLevel: "provider_call_creation_only",
    callTimeLimitSeconds: CALL_TIME_LIMIT_SECONDS,
    results,
  };
}
