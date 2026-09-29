import { createPostSaveResponse } from "./src/post-save-response.js";
import { createCallLifecycle } from "./src/call-lifecycle.js";
import "dotenv/config";
import path from "node:path";
import { createGreetingWatchdog, createOpeningAudioMonitor, createGreetingTurnGuard, createConversationOutputGuard } from "./src/greeting-watchdog.js";
import { createWarmTransfer, createTransferController, validTwilioSignature } from "./src/warm-transfer.js";
import { createTransferCompanion, createTransferHold, TRANSFER_DELAY_MS } from "./src/transfer-companion.js";
import express from "express";
import { createBilling } from "./src/billing/http.js";
import { provisionDemoNumbers } from "./src/demo-number-provision.js";
import OpenAI from "openai";
import WebSocket from "ws";

import {
  acceptRealtimeCall,
  referRealtimeCall,
  rejectRealtimeCall,
  hangupRealtimeCall,
  CONVERSATION_TURN_DETECTION,
} from "./src/openai-call.js";
import { appendLead } from "./src/lead-store.js";
import {
  buildOperatorInstructions,
  operatorRulesForTenant,
  normalizeLead,
  parseSipPhone,
  parseDialedNumber,
  tools,
} from "./src/operator.js";
import { createWixContact, createWixFollowupTask } from "./src/wix.js";
import { normalizeProofPilotInquiry, proofPilotLead, proofPilotInquiryKey } from "./src/proof-pilot.js";
import { proofPilotStatus, proofPilotScorecard } from "./src/proof-pilot-control.js";
import { GrowthMetricsStore, normalizeGrowthEvent } from "./src/growth-metrics.js";
import { RecoveryStore } from "./src/recovery/store.js";
import { RecoveryEngine } from "./src/recovery/engine.js";
import { mountReconciliationRoutes } from "./src/recovery/reconciliation-http.js";
import { radarProof } from "./src/recovery/radarproof.js";
import {
  cancellationBackfillCandidates,
  customer360,
  membershipRadar,
  ownerDailyBrief,
  opportunityTimeline,
  radarTrust,
  revenueLeakRadar,
  reviewRadar,
  searchCustomers,
} from "./src/growth-intelligence.js";
import { renderTemplate } from "./src/recovery/templates.js";
import { TenantRegistry, humanTransferTarget, tenantSecret } from "./src/recovery/tenant-registry.js";
import { requireBearer } from "./src/auth.js";
import { ActionDispatcher, voiceContactResolver } from "./src/integrations/dispatcher.js";
import { dispatchGate } from "./src/dispatch-gate.js";
import {
  buildTenantAdapters,
  wixCredentialsForTenant,
  bookingAdapterForTenant,
} from "./src/integrations/tenant-adapters.js";
import { normalizeIntake, isOptOutText, isSmsControlText } from "./src/intake.js";
import { JsonStateStore } from "./src/state-store.js";
import { leadLogSummary, maskPhone } from "./src/privacy.js";
import { prepareOnboardingFromWixSubmission } from "./src/onboarding/prepare.js";
import { deploymentPlan } from "./src/onboarding/deployment-plan.js";
import { tenantReadiness } from "./src/onboarding/readiness.js";
import { generateSmsReply, smsConversationEnabled } from "./src/sms-conversation.js";
import {
  WebChatStore,
  allowedWebChatOrigin,
  runWebChatTurn,
  webChatEnabled,
} from "./src/web-chat.js";
import { CallHistoryStore } from "./src/call-history.js";
import { assessVoiceHealth } from "./src/ops-health.js";
import { assessCustomerHealth } from "./src/customer-health.js";
import { runStartupPostgresHealth } from "./src/postgres-startup-health.js";
import {
  competitiveFeaturesForTenant,
  competitiveFeatureGuidance,
  inputTranscriptionForTenant,
  returningCallerContext,
  toolsForTenant,
} from "./src/competitive-features.js";

const {
  PORT = "5050",
  OPENAI_API_KEY = "",
  OPENAI_WEBHOOK_SECRET = "",
  OPENAI_REALTIME_MODEL = "gpt-realtime-2.1",
  OPENAI_VOICE = "marin",
  WARM_TRANSFER_ENABLED = "false",
  WARM_TRANSFER_SIP_DOMAIN = "",
  VOICE_PUBLIC_BASE_URL = "",
  TWILIO_ACCOUNT_SID = "",
  TWILIO_AUTH_TOKEN = "",
  TWILIO_VOICE_CALLER_ID = "",
  TWILIO_TRANSFER_SMS_FROM = "",
  LEADS_FILE = "./data/leads.jsonl",
  STATE_FILE = "./data/state.json",
  LOG_TRANSCRIPTS = "false",
  HTTP_TIMEOUT_MS = "8000",
  MAX_HTTP_RETRIES = "3",
  RECOVERY_STATE_FILE = "./data/recovery-state.json",
  TENANT_CONFIG_DIR = "./config/tenants",
  VOICE_ENABLED = "false",
  BOOKEDRADAR_INGEST_TOKEN = "",
  BOOKEDRADAR_ADMIN_TOKEN = "",
  RADARPROOF_PUBLIC = "false",
  DISPATCH_ENABLED = "false",
  DISPATCH_INTERVAL_SECONDS = "30",
  RETENTION_DAYS = "90",
  ACTION_RETENTION_DAYS = "180",
  CRM_SMOKE_TEST_ON_STARTUP = "false",
  EMAIL_SMOKE_TEST_ON_STARTUP = "false",
  E2E_SMOKE_TEST_ON_STARTUP = "false",
  TWILIO_A2P_DIAGNOSTIC_ON_STARTUP = "false",
  TWILIO_A2P_MESSAGING_SERVICE_SID = "",
  TWILIO_A2P_EXPECTED_ACCOUNT_SID = "",
  DEMO_NUMBER_PROVISION_MODE = "off",
  CALL_HISTORY_FILE = "./data/call-history.json",
  GROWTH_METRICS_FILE = "./data/growth-metrics.json",
  CALL_HISTORY_RETENTION_DAYS = "30",
  SMS_PUBLIC_BASE_URL = "",
  SMS_RESPONSE_MODEL = "gpt-5.6-luna",
  WEB_CHAT_STATE_FILE = "./data/web-chat.json",
  WEB_CHAT_RESPONSE_MODEL = "gpt-5.6-luna",
  ACCEPTANCE_AUDIT_ON_STARTUP = "false",
  ACCEPTANCE_AUDIT_CALL_IDS = "",
  DATABASE_URL = "",
  POSTGRES_HEALTH_ON_STARTUP = "false",
  POSTGRES_HEALTH_TIMEOUT_MS = "5000",
} = process.env;

const voiceEnabled = VOICE_ENABLED.toLowerCase() === "true";
if (voiceEnabled && !OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required when VOICE_ENABLED=true.");
}
if (voiceEnabled && !OPENAI_WEBHOOK_SECRET) {
  throw new Error("OPENAI_WEBHOOK_SECRET is required when VOICE_ENABLED=true.");
}

const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

const postgresStartupHealth = await runStartupPostgresHealth({
  enabled: POSTGRES_HEALTH_ON_STARTUP.toLowerCase() === "true",
  connectionString: DATABASE_URL,
  timeoutMs: Number(POSTGRES_HEALTH_TIMEOUT_MS),
  log: (event, fields) => console.log(JSON.stringify({ event, ...fields })),
});

const app = express();
app.disable("x-powered-by");

function securityHeaders(_req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cache-Control", "no-store");
  next();
}

function createRateLimiter({ windowMs = 60_000, max = 300 } = {}) {
  const buckets = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || req.socket?.remoteAddress || "unknown";
    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      res.setHeader("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({ ok: false, error: "rate_limited" });
    }
    if (buckets.size > 5000) {
      for (const [id, value] of buckets) {
        if (now >= value.resetAt) buckets.delete(id);
      }
    }
    next();
  };
}

app.set("trust proxy", 1);
app.use(securityHeaders);
app.use("/api", createRateLimiter({ max: 600 }));
app.use("/openai/webhook", createRateLimiter({ max: 1200 }));

// OpenAI signature verification requires raw JSON text.
app.use("/openai/webhook", express.text({ type: "application/json", limit: "256kb" }));
app.use('/stripe/webhook', express.raw({ type: 'application/json', limit: '256kb' }));
app.use(express.json({ limit: "256kb" }));

const state = new JsonStateStore(STATE_FILE);
await state.load();

const growthMetrics = new GrowthMetricsStore(GROWTH_METRICS_FILE);

const recoveryStore = new RecoveryStore(RECOVERY_STATE_FILE);
await recoveryStore.load();

const callHistory = new CallHistoryStore(CALL_HISTORY_FILE, {
  retentionDays: Number(CALL_HISTORY_RETENTION_DAYS),
});
await callHistory.load();

if (ACCEPTANCE_AUDIT_ON_STARTUP.toLowerCase() === "true") {
  const auditIds = String(ACCEPTANCE_AUDIT_CALL_IDS || "")
    .split(",").map(value => value.trim()).filter(Boolean).slice(0, 20);
  for (const auditCallId of auditIds) {
    const record = await callHistory.get("demo-hvac", auditCallId);
    console.log(JSON.stringify({
      event: "acceptance.audit",
      call_id: auditCallId,
      found: Boolean(record),
      spam_ended: Boolean(record?.spamEnded),
      transcript_turns: Array.isArray(record?.transcript) ? record.transcript.length : 0,
      knowledge_gaps: Array.isArray(record?.knowledgeGaps) ? record.knowledgeGaps.length : 0,
      has_lead_summary: Boolean(record?.leadSummary),
      transferred: Boolean(record?.transferred),
    }));
  }
}

const webChatStore = new WebChatStore(WEB_CHAT_STATE_FILE, {
  retentionDays: Number(CALL_HISTORY_RETENTION_DAYS),
});
await webChatStore.load();

const registry = await TenantRegistry.loadDirectory(TENANT_CONFIG_DIR);
const demoTenantForProvisioning = registry.get?.("demo-hvac") || registry.list().find(t => t.tenantId === "demo-hvac");
const existingDemoNumberForProvisioning = demoTenantForProvisioning?.integrations?.phone?.inboundNumbers?.[0] || "";
if (DEMO_NUMBER_PROVISION_MODE !== "off") {
  try {
    const result = await provisionDemoNumbers({
      accountSid: TWILIO_ACCOUNT_SID,
      authToken: TWILIO_AUTH_TOKEN,
      existingDemoNumber: existingDemoNumberForProvisioning,
      mode: DEMO_NUMBER_PROVISION_MODE,
      log: message => console.log(message),
    });
    if (DEMO_NUMBER_PROVISION_MODE === "discover") {
      console.log(JSON.stringify({ event: "demo.number.discovery_result", numbers: result.available || [] }));
    }
  } catch (error) {
    console.error(JSON.stringify({
      event: "demo.number.provision_failed",
      mode: DEMO_NUMBER_PROVISION_MODE,
      status: error?.status || null,
      reason: String(error?.message || "provision_failed").slice(0, 120),
      provider_detail: String(error?.detail || "").slice(0, 180),
    }));
  }
}
for (const tenant of registry.list()) {
  const readiness = tenantReadiness(tenant);
  console.log(JSON.stringify({
    event: "tenant.readiness.startup",
    tenant_id: tenant.tenantId,
    service_profile: tenant?.commercial?.serviceProfile || null,
    ready: readiness.ready,
    status: readiness.status,
    blocker_codes: [...new Set(readiness.blockers.map(item => item.code))],
    warning_codes: [...new Set(readiness.warnings.map(item => item.code))],
    configured_adapters: readiness.configuredAdapters,
    booking_adapter: readiness.bookingAdapter,
  }));
}
const billingMode = String(process.env.BOOKEDRADAR_BILLING_MODE || "test").trim().toLowerCase();
let billing = null;
try {
billing = await createBilling({
  tenantExists: tenantId => Boolean(registry.get(tenantId)),
  tenantProfile: tenantId => registry.get(tenantId)?.commercial?.serviceProfile || "",
  defaultStateFile: path.join(
    path.dirname(STATE_FILE),
    billingMode === "live" ? "billing-live-state.json" : "billing-test-state.json"
  ),
});
} catch (error) {
  // A billing configuration or provider failure must not stop voice/CRM startup.
  console.error(JSON.stringify({ event: "billing.startup_failed", mode: billingMode,
    error: /^[a-z_]+$/.test(error?.message || "") ? error.message : "billing_initialization_failed" }));
}
app.post('/stripe/webhook', (req, res) => billing
  ? billing.webhook(req, res)
  : res.status(503).json({ ok: false, error: 'billing_unavailable' }));
if (billing) app.use('/api/v1/billing', billing.api);
console.log(JSON.stringify({
  event: "billing.package_prices.startup",
  enabled: Boolean(billing),
  mode: billing?.billingMode || null,
  live_armed: billingMode === "live" ? process.env.BOOKEDRADAR_BILLING_LIVE_ARMED === "true" : false,
  disarmed: billing?.disarmed ?? true,
  configured: billing?.configuredPackagePrices || null,
  validated: billing?.validatedPackagePrices || null,
}));
app.get('/billing/return', (req, res) => {
  const message = req.query.result === 'cancelled'
    ? 'Checkout was cancelled. No payment was submitted through this Checkout session.'
    : req.query.result === 'submitted'
      ? 'Your payment submission has returned from Stripe. Bank payments can take time to confirm. Billing status updates only after confirmation from Stripe.'
      : 'You have returned from the billing portal.';
  res.type('html').send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>BookedRadar billing</title><h1>BookedRadar billing</h1><p>${message}</p><p>Returning to this page does not change telephone service.</p></html>`);
});

const transferStore = new JsonStateStore(path.join(path.dirname(STATE_FILE), "voice-transfers.json"));
await transferStore.load();
const warmTransfer = createWarmTransfer({
  store: transferStore, registry,
  config: { enabled: WARM_TRANSFER_ENABLED === "true", domain: WARM_TRANSFER_SIP_DOMAIN,
    baseUrl: VOICE_PUBLIC_BASE_URL, accountSid: TWILIO_ACCOUNT_SID,
    authToken: TWILIO_AUTH_TOKEN, callerId: TWILIO_VOICE_CALLER_ID },
  log: (event, fields) => console.log(JSON.stringify({ event, ...fields })),
});
const guardedTransfer = createTransferController({
  relay: warmTransfer,
  refer: ({ targetUri, callId }) => referRealtimeCall({ apiKey: OPENAI_API_KEY, callId, targetUri }),
  log: (event, fields) => console.log(JSON.stringify({ event, ...fields })),
});
const transferCompanion = createTransferCompanion({
  config: { accountSid: TWILIO_ACCOUNT_SID, authToken: TWILIO_AUTH_TOKEN,
    fromNumber: TWILIO_TRANSFER_SMS_FROM || TWILIO_VOICE_CALLER_ID },
  log: (event, fields) => console.log(JSON.stringify({ event, ...fields })),
});
console.log(JSON.stringify({ event: "transfer.sms_preflight", scope: "startup", configured: transferCompanion.ready(), delay_ms: TRANSFER_DELAY_MS }));
if (TWILIO_A2P_DIAGNOSTIC_ON_STARTUP.toLowerCase() === "true") {
  const serviceSid = String(TWILIO_A2P_MESSAGING_SERVICE_SID || "").trim();
  const accountSid = String(TWILIO_ACCOUNT_SID || "").trim();
  const authToken = String(TWILIO_AUTH_TOKEN || "");
  const expectedAccountSid = String(TWILIO_A2P_EXPECTED_ACCOUNT_SID || "").trim();
  const expectedFrom = String(TWILIO_TRANSFER_SMS_FROM || TWILIO_VOICE_CALLER_ID || "").trim();
  const auth = accountSid && authToken
    ? `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`
    : "";

  const read = async (url) => {
    try {
      const response = await fetch(url, {
        headers: { Authorization: auth },
        signal: AbortSignal.timeout(8000),
      });
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch {}
      return { status: response.status, ok: response.ok, data };
    } catch (error) {
      return { status: null, ok: false, data: null, error: String(error?.name || "fetch_failed") };
    }
  };

  if (!/^MG[0-9a-f]{32}$/i.test(serviceSid)) {
    console.error(JSON.stringify({ event: "twilio.a2p_diagnostic", ok: false, reason: "messaging_service_sid_invalid" }));
  } else if (!/^AC[0-9a-f]{32}$/i.test(accountSid) || !authToken) {
    console.error(JSON.stringify({ event: "twilio.a2p_diagnostic", ok: false, reason: "twilio_credentials_missing" }));
  } else {
    const [accountCheck, serviceCheck, campaignCheck, phoneCheck] = await Promise.all([
      read(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`),
      read(`https://messaging.twilio.com/v1/Services/${serviceSid}`),
      read(`https://messaging.twilio.com/v1/Services/${serviceSid}/Compliance/Usa2p`),
      read(`https://messaging.twilio.com/v1/Services/${serviceSid}/PhoneNumbers?PageSize=100`),
    ]);

    const campaignData = campaignCheck.data;
    const campaigns = Array.isArray(campaignData?.usa2p) ? campaignData.usa2p
      : Array.isArray(campaignData?.us_app_to_person) ? campaignData.us_app_to_person
      : Array.isArray(campaignData?.resources) ? campaignData.resources
      : [];

    const phoneData = phoneCheck.data;
    const phones = Array.isArray(phoneData?.phone_numbers) ? phoneData.phone_numbers
      : Array.isArray(phoneData?.phoneNumbers) ? phoneData.phoneNumbers
      : [];

    const normalizedExpected = expectedFrom.replace(/\D/g, "");
    const sendingNumberPresent = normalizedExpected
      ? phones.some((item) => String(item?.phone_number || item?.phoneNumber || "").replace(/\D/g, "") === normalizedExpected)
      : false;

    const campaign = campaigns[0] || null;
    console.log(JSON.stringify({
      event: "twilio.a2p_diagnostic",
      ok: accountCheck.ok && serviceCheck.ok && campaignCheck.ok && phoneCheck.ok,
      account_sid_matches_submission: Boolean(expectedAccountSid) && accountSid === expectedAccountSid,
      account_api_status: accountCheck.status,
      messaging_service_api_status: serviceCheck.status,
      campaign_api_status: campaignCheck.status,
      sender_pool_api_status: phoneCheck.status,
      messaging_service_found: Boolean(serviceCheck.data?.sid),
      service_a2p_registered: Boolean(serviceCheck.data?.us_app_to_person_registered),
      campaign_count: campaigns.length,
      campaign_status: campaign?.campaign_status || campaign?.campaignStatus || null,
      campaign_errors: Array.isArray(campaign?.errors) ? campaign.errors.length : 0,
      sender_pool_count: phones.length,
      sending_number_present: sendingNumberPresent,
    }));
  }
}

const transferFallbackReady = Boolean(OPENAI_API_KEY && registry.list().every(tenant => humanTransferTarget(tenant)));
console.log(JSON.stringify({ event: "transfer.preflight", scope: "startup", ...warmTransfer.preflight(), fallback_ready: transferFallbackReady }));
app.use("/voice/transfer", createRateLimiter({ max: 1200 }), warmTransfer.router);
const logTranscripts = LOG_TRANSCRIPTS.toLowerCase() === "true";
const timeoutMs = Number(HTTP_TIMEOUT_MS);
const retries = Number(MAX_HTTP_RETRIES);

const engines = new Map();
const dispatchers = new Map();

function engineFor(tenant) {
  if (!engines.has(tenant.tenantId)) {
    engines.set(
      tenant.tenantId,
      new RecoveryEngine({ store: recoveryStore, tenant })
    );
  }
  return engines.get(tenant.tenantId);
}

async function latestOpenOpportunityForContact(tenantId, contactKey) {
  const snapshot = await recoveryStore.snapshot();
  return Object.values(snapshot.opportunities || {})
    .filter(item =>
      item.tenantId === tenantId &&
      item.contactKey === contactKey &&
      item.status !== "closed"
    )
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))[0] || null;
}

function dispatcherFor(tenant) {
  if (!dispatchers.has(tenant.tenantId)) {
    const adapters = buildTenantAdapters(tenant, { timeoutMs, retries });
    dispatchers.set(
      tenant.tenantId,
      {
        adapters,
        dispatcher: new ActionDispatcher({
          store: recoveryStore,
          tenant,
          adapters,
          resolveContact: voiceContactResolver(state, tenant.tenantId),
          workerId: `bookedradar-${tenant.tenantId}-${process.pid}`,
        }),
      }
    );
  }
  return dispatchers.get(tenant.tenantId);
}

for (const tenant of registry.list()) {
  const wix = wixCredentialsForTenant(tenant);
  const { adapters } = dispatcherFor(tenant);
  console.log(JSON.stringify({
    event: "integration.preflight",
    tenant_id: tenant.tenantId,
    crm_enabled: Boolean(tenant?.integrations?.crm?.enabled),
    crm_credentials_configured: Boolean(wix),
    email_enabled: Boolean(tenant?.integrations?.email?.enabled),
    resend_global_key_configured: Boolean(process.env.RESEND_API_KEY),
    resend_tenant_key_configured: Boolean(
      tenant?.secretsPrefix && process.env[`${tenant.secretsPrefix}_RESEND_API_KEY`]
    ),
    resend_sender_configured: Boolean(
      tenant?.integrations?.email?.from ||
      process.env.RESEND_FROM_EMAIL ||
      (tenant?.secretsPrefix && process.env[`${tenant.secretsPrefix}_RESEND_FROM_EMAIL`])
    ),
    sms_enabled: Boolean(tenant?.integrations?.sms?.enabled),
    dispatch_channels: Object.keys(adapters),
    dispatch_mode: dispatchGate(tenant, { DISPATCH_ENABLED }).tenantMode,
    dispatch_armed: dispatchGate(tenant, { DISPATCH_ENABLED }).armed,
  }));
}

if (EMAIL_SMOKE_TEST_ON_STARTUP.toLowerCase() === "true") {
  for (const tenant of registry.list()) {
    const { adapters } = dispatcherFor(tenant);
    if (!adapters.email) {
      console.log(JSON.stringify({
        event: "email.smoke_test",
        tenant_id: tenant.tenantId,
        ok: false,
        reason: "email_adapter_not_configured",
      }));
      continue;
    }
    try {
      const result = await adapters.email.send({
        contact: { email: "delivered@resend.dev" },
        content: "BookedRadar transactional email provider production smoke test.",
        tenant,
        action: {
          id: "resend-production-smoke-v1",
          opportunityId: "internal-smoke-test",
          template: "internal_smoke_test",
        },
      });
      console.log(JSON.stringify({
        event: "email.smoke_test",
        tenant_id: tenant.tenantId,
        ok: true,
        provider: result?.provider || null,
        email_id: result?.id || null,
      }));
    } catch (error) {
      console.error(JSON.stringify({
        event: "email.smoke_test",
        tenant_id: tenant.tenantId,
        ok: false,
        message: String(error?.message || error).slice(0, 400),
      }));
    }
  }
}

if (CRM_SMOKE_TEST_ON_STARTUP.toLowerCase() === "true") {
  for (const tenant of registry.list()) {
    const wix = wixCredentialsForTenant(tenant);
    if (!wix) {
      console.log(JSON.stringify({
        event: "crm.smoke_test",
        tenant_id: tenant.tenantId,
        ok: false,
        reason: "credentials_not_configured",
      }));
      continue;
    }
    try {
      const lead = {
        name: "BookedRadar CRM Permission Test",
        service_type: "internal_qa",
        urgency: "test",
        notes: "Temporary internal CRM permission test. Safe to delete.",
      };
      const contact = await createWixContact({
        apiKey: wix.apiKey,
        siteId: wix.siteId,
        lead,
        timeoutMs,
        retries,
      });
      if (!contact?.ok || !contact?.contactId) {
        throw new Error(contact?.reason || "contact_create_failed");
      }
      const task = await createWixFollowupTask({
        apiKey: wix.apiKey,
        siteId: wix.siteId,
        contactId: contact.contactId,
        lead,
        dueInMinutes: 0,
        timeoutMs,
        retries,
      });
      if (!task?.ok || !task?.taskId) {
        throw new Error("task_create_failed");
      }
      console.log(JSON.stringify({
        event: "crm.smoke_test",
        tenant_id: tenant.tenantId,
        ok: true,
        contact_id: contact.contactId,
        task_id: task.taskId,
      }));
    } catch (error) {
      console.error(JSON.stringify({
        event: "crm.smoke_test",
        tenant_id: tenant.tenantId,
        ok: false,
        message: String(error?.message || error).slice(0, 400),
      }));
    }
  }
}

function tenantFromRequest(req) {
  const tenantId =
    String(req.headers["x-bookedradar-tenant"] || "") ||
    String(req.query?.tenant || "");
  return registry.resolve({ tenantId });
}

function requireTenant(req, res, next) {
  const tenant = tenantFromRequest(req);
  if (!tenant) {
    return res.status(400).json({
      ok: false,
      error: "tenant_required_or_unknown",
    });
  }
  req.bookedRadarTenant = tenant;
  next();
}

function localBusinessContext(tenant) {
  const timeZone = tenant.timeZone || "America/Chicago";
  const localTime = new Intl.DateTimeFormat("en-US", {
    timeZone,
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date());

  const hours = tenant.businessHours || {};
  const labels = [
    ["mon", "Mon"], ["tue", "Tue"], ["wed", "Wed"], ["thu", "Thu"],
    ["fri", "Fri"], ["sat", "Sat"], ["sun", "Sun"],
  ];
  const businessHoursText = labels
    .map(([key, label]) => {
      const window = hours[key];
      return `${label} ${Array.isArray(window) ? `${window[0]}-${window[1]}` : "closed"}`;
    })
    .join(", ");

  return { localTime, businessHoursText };
}

function send(ws, event) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event));
  }
}

function recordCallMilestone(callId, event, fields = {}) {
  const latencyCandidate =
    fields.latencyMs ?? fields.elapsed_ms ?? fields.acceptance_ms;
  const reason =
    fields.reason ?? fields.outcome ?? fields.code ?? "";
  void callHistory.mark(callId, event, {
    at: Date.now(),
    ...(Number.isFinite(Number(latencyCandidate))
      ? { latencyMs: Number(latencyCandidate) }
      : {}),
    ...(reason ? { reason: String(reason).slice(0, 160) } : {}),
    ...(fields.ok === false ? { ok: false } : {}),
  }).catch(() => {
    console.error(JSON.stringify({
      event: "ops.milestone_write_failed",
      call_id: callId,
      milestone: event,
    }));
  });
}

async function executeTool({
  name,
  args,
  callId,
  callerNumber,
  tenant,
  syncCrm = true,
  transferHold,
}) {
  const engine = engineFor(tenant);

  if (name === "capture_lead") {
    const existingCall = await state.getCall(callId);
    const lead = normalizeLead(args, {
      call_id…10802 tokens truncated…{
      event: "growth.proof_pilot_inquiry",
      trade: parsed.inquiry.trade,
      crm_contact_id: contact.contactId,
      task_id: task.taskId || null,
    }));
    return res.status(201).json({ ok: true, message: "Thanks. BookedRadar will review your workflow and follow up." });
  } catch (error) {
    await state.releaseWebhook(submissionKey).catch(() => {});
    console.error(JSON.stringify({ event: "growth.proof_pilot_inquiry_failed", reason: String(error?.message || "failed").slice(0, 120) }));
    return res.status(503).json({ ok: false, error: "inquiry_capture_failed" });
  }
});

app.post("/api/v1/onboarding/prepare", requireAdmin, (req, res) => {
  try {
    const result = prepareOnboardingFromWixSubmission(req.body || {});
    return res.json({ ok: true, result });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error: String(error?.message || "onboarding_prepare_failed").slice(0, 300),
    });
  }
});

app.post("/api/v1/admin/prune", requireAdmin, async (_req, res) => {
  try {
    const result = await recoveryStore.prune({
      eventRetentionDays: Number(RETENTION_DAYS),
      actionRetentionDays: Number(ACTION_RETENTION_DAYS),
    });
    return res.json({ ok: true, result });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "prune_failed" });
  }
});

app.post("/api/v1/dispatch/run", requireAdmin, requireTenant, async (req, res) => {
  try {
    const tenant = req.bookedRadarTenant;
    const gate = dispatchGate(tenant, { DISPATCH_ENABLED });
    if (!gate.armed) {
      return res.status(409).json({ ok: false, error: "dispatch_not_armed", gate });
    }
    const limit = Math.min(Math.max(Number(req.body?.limit || 25), 1), 100);
    const { adapters, dispatcher } = dispatcherFor(tenant);
    const results = await dispatcher.runOnce({ limit });

    return res.json({
      ok: true,
      tenantId: tenant.tenantId,
      configuredChannels: Object.keys(adapters),
      results,
    });
  } catch (error) {
    console.error("Dispatch run failed:", error);
    return res.status(500).json({ ok: false, error: "dispatch_failed" });
  }
});

app.get("/api/v1/customers/search", requireAdmin, requireTenant, async (req, res) => {
  try {
    const results = await searchCustomers(
      recoveryStore,
      req.bookedRadarTenant.tenantId,
      req.query.q || "",
      { limit: req.query.limit || 20 }
    );
    return res.json({ ok: true, results });
  } catch {
    return res.status(500).json({ ok: false, error: "customer_search_failed" });
  }
});

app.get("/api/v1/customer-360", requireAdmin, requireTenant, async (req, res) => {
  try {
    const profile = await customer360(
      recoveryStore,
      req.bookedRadarTenant.tenantId,
      req.query.contactKey || ""
    );
    return profile
      ? res.json({ ok: true, profile })
      : res.status(404).json({ ok: false, error: "customer_not_found" });
  } catch {
    return res.status(500).json({ ok: false, error: "customer_360_failed" });
  }
});

app.get("/api/v1/membership-radar", requireAdmin, requireTenant, async (req, res) => {
  try {
    return res.json({
      ok: true,
      report: await membershipRadar(recoveryStore, req.bookedRadarTenant.tenantId),
    });
  } catch {
    return res.status(500).json({ ok: false, error: "membership_radar_failed" });
  }
});

app.get("/api/v1/review-radar", requireAdmin, requireTenant, async (req, res) => {
  try {
    return res.json({
      ok: true,
      report: await reviewRadar(recoveryStore, req.bookedRadarTenant.tenantId),
    });
  } catch {
    return res.status(500).json({ ok: false, error: "review_radar_failed" });
  }
});

app.get("/api/v1/opportunities/:id/backfill-candidates", requireAdmin, requireTenant, async (req, res) => {
  try {
    const report = await cancellationBackfillCandidates(
      recoveryStore,
      req.bookedRadarTenant.tenantId,
      req.params.id
    );
    return report
      ? res.json({ ok: true, report })
      : res.status(404).json({ ok: false, error: "cancellation_opportunity_not_found" });
  } catch {
    return res.status(500).json({ ok: false, error: "backfill_candidate_query_failed" });
  }
});

app.get("/api/v1/proof-pilot/status", requireAdmin, requireTenant, async (req, res) => {
  try {
    const tenant = req.bookedRadarTenant;
    const config = tenant?.commercial?.proofPilot || {};
    const startMs = Date.parse(config.startAt || "") || 0;
    const callStats = await callHistory.statsSince(tenant.tenantId, startMs);
    const proof = await radarProof(recoveryStore, tenant.tenantId, { sinceMs: startMs });
    const failedActions = await recoveryStore.failedActions(tenant.tenantId);
    const criticalFailures = failedActions.filter(action =>
      ["human_alert", "human_task"].includes(String(action.channel || "")) ||
      String(action.lastError || "").toLowerCase().includes("transfer")
    ).length;
    const status = proofPilotStatus(config, {
      callsHandled: callStats.callsHandled,
      criticalFailures,
      firstValueAt: callStats.firstUsefulLeadAt ? new Date(callStats.firstUsefulLeadAt).toISOString() : "",
    });
    const scorecard = proofPilotScorecard({
      status: status.status,
      callsHandled: callStats.callsHandled,
      qualifiedOpportunities: proof.opportunitiesCaptured,
      humanTransfers: callStats.humanTransfers,
      incompleteCalls: callStats.incompleteCalls,
      recoveredOpportunities: proof.recoveredOpportunities,
      confirmedRevenue: proof.confirmedRevenue,
      criticalFailures,
      firstValueAt: status.firstValueAt,
    });
    return res.json({
      ok: true,
      tenantId: tenant.tenantId,
      status,
      scorecard,
      proof,
      guardrail: status.status === "ACTIVE" || status.status === "SCHEDULED"
        ? "PILOT_WITHIN_APPROVED_SCOPE"
        : "DO_NOT_EXPAND_OR_CONTINUE_PILOT_TRAFFIC_UNTIL_REVIEWED",
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "proof_pilot_status_failed" });
  }
});

app.get("/api/v1/deployment-plan", requireAdmin, requireTenant, async (req, res) => {
  try {
    const foundingPartner = String(req.query.founding || "true").toLowerCase() !== "false";
    return res.json({
      ok: true,
      plan: deploymentPlan(req.bookedRadarTenant, { foundingPartner }),
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "deployment_plan_failed",
      message: String(error?.message || error).slice(0, 200),
    });
  }
});

app.get("/api/v1/revenue-leaks", requireAdmin, requireTenant, async (req, res) => {
  try {
    return res.json({
      ok: true,
      report: await revenueLeakRadar(recoveryStore, req.bookedRadarTenant.tenantId),
    });
  } catch {
    return res.status(500).json({ ok: false, error: "revenue_leak_report_failed" });
  }
});

app.get("/api/v1/owner-brief", requireAdmin, requireTenant, async (req, res) => {
  try {
    const callActivity = await callHistory.stats(req.bookedRadarTenant.tenantId);
    return res.json({
      ok: true,
      brief: await ownerDailyBrief(recoveryStore, req.bookedRadarTenant.tenantId, { callActivity }),
    });
  } catch {
    return res.status(500).json({ ok: false, error: "owner_brief_failed" });
  }
});

app.get("/api/v1/opportunities/:id/timeline", requireAdmin, requireTenant, async (req, res) => {
  try {
    const result = await opportunityTimeline(
      recoveryStore,
      req.bookedRadarTenant.tenantId,
      req.params.id
    );
    return result
      ? res.json({ ok: true, result })
      : res.status(404).json({ ok: false, error: "opportunity_not_found" });
  } catch {
    return res.status(500).json({ ok: false, error: "opportunity_timeline_failed" });
  }
});

app.get("/api/v1/radartrust", requireAdmin, requireTenant, async (req, res) => {
  try {
    const callActivity = await callHistory.stats(req.bookedRadarTenant.tenantId);
    return res.json({
      ok: true,
      report: await radarTrust(recoveryStore, req.bookedRadarTenant, { callActivity }),
    });
  } catch {
    return res.status(500).json({ ok: false, error: "radartrust_failed" });
  }
});

app.get("/api/v1/ops/voice-health", requireAdmin, async (req, res) => {
  try {
    const hours = Math.min(Math.max(Number(req.query.hours || 24), 1), 168);
    const tenantId = String(req.query.tenant || "").trim();
    if (tenantId && tenantId !== "__unrouted__" && !registry.get(tenantId)) {
      return res.status(400).json({ ok: false, error: "unknown_tenant" });
    }
    const sinceMs = Date.now() - hours * 60 * 60 * 1000;
    const summary = await callHistory.operationalSummary({ tenantId, sinceMs });
    return res.json({
      ok: true,
      windowHours: hours,
      summary,
      assessment: assessVoiceHealth(summary),
      runtime: {
        activeVoiceCalls: callLifecycle.count(),
        draining: callLifecycle.isDraining(),
      },
    });
  } catch {
    return res.status(500).json({ ok: false, error: "voice_health_failed" });
  }
});

app.get("/api/v1/ops/customer-health", requireAdmin, async (req, res) => {
  try {
    const tenantId = String(req.query.tenant || "").trim();
    const tenant = registry.get(tenantId);
    if (!tenant) {
      return res.status(400).json({ ok: false, error: "known_tenant_required" });
    }

    const hours = Math.min(Math.max(Number(req.query.hours || 168), 1), 720);
    const sinceMs = Date.now() - hours * 60 * 60 * 1000;
    const voiceSummary = await callHistory.operationalSummary({ tenantId, sinceMs });
    const voiceAssessment = assessVoiceHealth(voiceSummary);
    const readiness = tenantReadiness(tenant);
    const failedActions = await recoveryStore.failedActions(tenantId);
    const criticalFailedActions = failedActions.filter(action =>
      ["human_alert", "human_task"].includes(String(action.channel || "")) ||
      String(action.lastError || "").toLowerCase().includes("transfer")
    ).length;
    const proof = await radarProof(recoveryStore, tenantId);
    const callActivity = await callHistory.stats(tenantId);
    const recoverySnapshot = await recoveryStore.snapshot();
    const recentOpportunities = Object.values(recoverySnapshot.opportunities || {}).filter(item => {
      if (item.tenantId !== tenantId) return false;
      const timestamp = Date.parse(item.createdAt || item.updatedAt || "");
      return Number.isFinite(timestamp) && timestamp >= sinceMs;
    }).length;

    const health = assessCustomerHealth({
      voiceAssessment,
      readinessBlockers: readiness.blockers.length,
      criticalFailedActions,
      totalFailedActions: failedActions.length,
      crmSyncFailures: voiceSummary.crmSyncFailures,
      recentCalls: voiceSummary.callsStarted,
      opportunitiesCaptured: recentOpportunities,
    });

    return res.json({
      ok: true,
      tenantId,
      businessName: tenant.businessName,
      windowHours: hours,
      health,
      evidence: {
        readiness: {
          ready: readiness.ready,
          status: readiness.status,
          blockerCodes: [...new Set(readiness.blockers.map(item => item.code))],
        },
        voice: {
          summary: voiceSummary,
          assessment: voiceAssessment,
        },
        recovery: {
          failedActions: failedActions.length,
          criticalFailedActions,
        },
        activity: {
          recentOpportunities,
        },
        value: {
          opportunitiesCaptured: proof.opportunitiesCaptured,
          recoveredOpportunities: proof.recoveredOpportunities,
          confirmedRevenue: proof.confirmedRevenue,
          estimatedRecoveredValue: proof.estimatedRecoveredValue,
        },
        learning: {
          knowledgeGapsObserved: callActivity.knowledgeGaps,
        },
      },
    });
  } catch {
    return res.status(500).json({ ok: false, error: "customer_health_failed" });
  }
});

app.get("/api/v1/radarproof", async (req, res) => {
  if (RADARPROOF_PUBLIC.toLowerCase() !== "true") {
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!BOOKEDRADAR_ADMIN_TOKEN || token !== BOOKEDRADAR_ADMIN_TOKEN) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }
  }

  const tenant = tenantFromRequest(req);
  if (!tenant) {
    return res.status(400).json({ ok: false, error: "tenant_required_or_unknown" });
  }

  try {
    const report = await radarProof(recoveryStore, tenant.tenantId);
    report.callActivity = await callHistory.stats(tenant.tenantId);
    return res.json({
      ok: true,
      tenantId: tenant.tenantId,
      report,
    });
  } catch {
    return res.status(500).json({ ok: false, error: "radarproof_failed" });
  }
});

app.use("/dashboard", express.static("public"));
app.use("/assets", express.static("public"));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "bookedradar-platform",
    version: "2.0.0",
    billingMode: billing?.billingMode || 'disabled',
    billingLiveArmed: billingMode === 'live' && process.env.BOOKEDRADAR_BILLING_LIVE_ARMED === 'true',
    voiceReliabilityRevision: "2026-09-22.2",
    screenedTransferReady: warmTransfer.ready(),
    transferFallbackReady,
    transferSmsConfigured: transferCompanion.ready(),
    transferDelayMs: TRANSFER_DELAY_MS,
    transferMode: warmTransfer.ready() ? "screened_with_refer_fallback" : "refer_fallback",
    tenants: registry.list().length,
    voiceEnabled,
    activeVoiceCalls: callLifecycle.count(),
    draining: callLifecycle.isDraining(),
  });
});

app.get("/ready", requireAdmin, (_req, res) => {
  res.json({
    ready: true,
    tenants: registry.list().map((tenant) => ({
      tenantId: tenant.tenantId,
      businessName: tenant.businessName,
      inboundNumbersConfigured:
        (tenant?.integrations?.phone?.inboundNumbers || []).length,
      dispatchChannels: Object.keys(dispatcherFor(tenant).adapters),
      competitiveFeatures: competitiveFeaturesForTenant(tenant),
    })),
    voice: {
      enabled: voiceEnabled,
      apiKeyConfigured: Boolean(OPENAI_API_KEY),
      webhookSecretConfigured: Boolean(OPENAI_WEBHOOK_SECRET),
    },
    postgresShadow: {
      configured: Boolean(DATABASE_URL),
      healthCheckEnabled: POSTGRES_HEALTH_ON_STARTUP.toLowerCase() === "true",
      startup: postgresStartupHealth,
      authoritative: false,
    },
  });
});

app.post("/openai/webhook", async (req, res) => {
  if (!voiceEnabled || !openai) {
    return res.status(503).send("Voice service is not enabled");
  }

  let event;
  try {
    event = await openai.webhooks.unwrap(
      req.body,
      req.headers,
      OPENAI_WEBHOOK_SECRET
    );
  } catch (error) {
    return res.status(400).send("Invalid signature");
  }

  if (callLifecycle.isDraining()) return res.status(503).send("Service restarting; retry shortly");

  const webhookId = req.header("webhook-id") || event?.id;
  if (!(await state.markWebhookOnce(webhookId))) {
    return res.status(200).send("duplicate ignored");
  }

  res.status(200).send("ok");

  if (event.type === "realtime.call.incoming") {
    const callId = event?.data?.call_id;
    if (!callLifecycle.begin(callId)) return;
    handleIncomingCall(event).catch(async (error) => {
      callLifecycle.end(callId);
      recordCallMilestone(callId, "call.accept_failed", {
        ok: false,
        reason: "incoming_call_failed",
      });
      try {
        await callHistory.finish(callId, { endReason: "incoming_call_failed" });
      } catch {}
      console.error(JSON.stringify({
        event: "incoming_call.failed",
        call_id: event?.data?.call_id || null,
        message: String(error?.message || error).slice(0, 400),
      }));
    });
  }
});

if (E2E_SMOKE_TEST_ON_STARTUP.toLowerCase() === "true") {
  for (const tenant of registry.list()) {
    try {
      const e2eKey = `internal-e2e:${tenant.tenantId}:2026-09-23-v1`;
      const intake = await engineFor(tenant).ingest({
        idempotencyKey: e2eKey,
        occurredAt: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
        type: "web_lead",
        source: "internal_e2e_smoke_test",
        serviceType: "repair",
        urgency: "test",
        contact: {
          name: "BookedRadar E2E Test",
          email: "delivered@resend.dev",
        },
        metadata: {
          notes: "Internal synthetic end-to-end production verification.",
        },
      });

      if (intake?.duplicate || !intake?.opportunity?.id) {
        console.log(JSON.stringify({
          event: "e2e.smoke_test",
          tenant_id: tenant.tenantId,
          ok: true,
          duplicate: true,
          reason: intake?.reason || "existing_test_event",
        }));
        continue;
      }

      const { dispatcher } = dispatcherFor(tenant);
      const dispatchResults = await dispatcher.runOnce({
        now: new Date(),
        limit: 25,
      });

      await engineFor(tenant).ingest({
        idempotencyKey: `${e2eKey}:close`,
        type: "opportunity_lost",
        opportunityId: intake.opportunity.id,
        source: "internal_e2e_smoke_test_cleanup",
      });

      console.log(JSON.stringify({
        event: "e2e.smoke_test",
        tenant_id: tenant.tenantId,
        ok: true,
        opportunity_id: intake.opportunity.id,
        actions: dispatchResults
          .filter((item) => item?.action?.opportunityId === intake.opportunity.id)
          .map((item) => ({
            channel: item.action.channel,
            dispatched: Boolean(item.dispatched),
            provider: item.result?.provider || null,
            email_id: item.result?.id || null,
            wix_contact_id: item.result?.contactId || null,
            wix_task_id: item.result?.taskId || null,
            error: item.error || null,
          })),
      }));
    } catch (error) {
      console.error(JSON.stringify({
        event: "e2e.smoke_test",
        tenant_id: tenant.tenantId,
        ok: false,
        message: String(error?.message || error).slice(0, 500),
      }));
    }
  }
}

let dispatchTimer = null;
let dispatchRunning = false;
const dispatchIntervalSeconds = Number(DISPATCH_INTERVAL_SECONDS || 0);

async function runAutomaticDispatch() {
  if (dispatchRunning) return;
  dispatchRunning = true;
  try {
    for (const tenant of registry.list()) {
      const gate = dispatchGate(tenant, { DISPATCH_ENABLED });
      if (!gate.armed) continue;
      const { dispatcher } = dispatcherFor(tenant);
      await dispatcher.runOnce({ limit: 50 });
    }
  } catch (error) {
    console.error(JSON.stringify({
      event: "automatic_dispatch.error",
      message: String(error?.message || error).slice(0, 400),
    }));
  } finally {
    dispatchRunning = false;
  }
}

if (dispatchIntervalSeconds > 0 && String(DISPATCH_ENABLED).trim().toLowerCase() === "true") {
  runAutomaticDispatch().catch(() => {});
  dispatchTimer = setInterval(
    runAutomaticDispatch,
    Math.max(10, dispatchIntervalSeconds) * 1000
  );
  dispatchTimer.unref();
}

const server = app.listen(Number(PORT), "0.0.0.0", () => {
  console.log(
    `BookedRadar Platform v2.0 listening on port ${PORT} for ${registry.list().length} tenant(s)`
  );
});

async function shutdown(signal) {
  if (dispatchTimer) clearInterval(dispatchTimer);
  console.log(JSON.stringify({ event: "server.shutdown", signal }));
  callLifecycle.shutdown(done => server.close(done));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
