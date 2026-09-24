import { createCallLifecycle } from "./src/call-lifecycle.js";
import "dotenv/config";
import path from "node:path";
import { createGreetingWatchdog, createOpeningAudioMonitor, createGreetingTurnGuard } from "./src/greeting-watchdog.js";
import { createWarmTransfer, createTransferController } from "./src/warm-transfer.js";
import { createTransferCompanion, createTransferHold, TRANSFER_DELAY_MS } from "./src/transfer-companion.js";
import express from "express";
import { createBilling } from "./src/billing/http.js";
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
import { RecoveryStore } from "./src/recovery/store.js";
import { RecoveryEngine } from "./src/recovery/engine.js";
import { radarProof } from "./src/recovery/radarproof.js";
import { renderTemplate } from "./src/recovery/templates.js";
import { TenantRegistry, humanTransferTarget } from "./src/recovery/tenant-registry.js";
import { requireBearer } from "./src/auth.js";
import { ActionDispatcher, voiceContactResolver } from "./src/integrations/dispatcher.js";
import {
  buildTenantAdapters,
  wixCredentialsForTenant,
  bookingAdapterForTenant,
} from "./src/integrations/tenant-adapters.js";
import { normalizeIntake, isOptOutText } from "./src/intake.js";
import { JsonStateStore } from "./src/state-store.js";
import { leadLogSummary, maskPhone } from "./src/privacy.js";
import { prepareOnboardingFromWixSubmission } from "./src/onboarding/prepare.js";

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
  DISPATCH_INTERVAL_SECONDS = "30",
  RETENTION_DAYS = "90",
  ACTION_RETENTION_DAYS = "180",
  CRM_SMOKE_TEST_ON_STARTUP = "false",
  EMAIL_SMOKE_TEST_ON_STARTUP = "false",
  E2E_SMOKE_TEST_ON_STARTUP = "false",
  TWILIO_A2P_DIAGNOSTIC_ON_STARTUP = "false",
  TWILIO_A2P_MESSAGING_SERVICE_SID = "",
  TWILIO_A2P_EXPECTED_ACCOUNT_SID = "",
} = process.env;

const voiceEnabled = VOICE_ENABLED.toLowerCase() === "true";
if (voiceEnabled && !OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required when VOICE_ENABLED=true.");
}
if (voiceEnabled && !OPENAI_WEBHOOK_SECRET) {
  throw new Error("OPENAI_WEBHOOK_SECRET is required when VOICE_ENABLED=true.");
}

const openai = voiceEnabled ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;
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

const recoveryStore = new RecoveryStore(RECOVERY_STATE_FILE);
await recoveryStore.load();

const registry = await TenantRegistry.loadDirectory(TENANT_CONFIG_DIR);
const billing = await createBilling({
  tenantExists: tenantId => Boolean(registry.get(tenantId)),
  defaultStateFile: path.join(path.dirname(STATE_FILE), 'billing-test-state.json'),
});
app.post('/stripe/webhook', (req, res) => billing
  ? billing.webhook(req, res)
  : res.status(503).json({ ok: false, error: 'test_billing_disabled' }));
if (billing) app.use('/api/v1/billing', billing.api);
app.get('/billing/return', (_req, res) => res.type('html').send(
  '<!doctype html><html lang="en"><meta charset="utf-8"><title>BookedRadar test billing</title><h1>BookedRadar test billing</h1><p>Your payment submission has returned from Stripe. Bank payments can take time to confirm. BookedRadar updates billing status only after confirmation from Stripe.</p><p>No live telephone service is changed by this test.</p></html>'
));

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
      call_id: callId,
      caller_number: callerNumber,
      previous_lead: existingCall?.lastLead,
    });

    await appendLead(LEADS_FILE, {
      ...lead,
      tenant_id: tenant.tenantId,
    });

    let recoveryResult;

    if (existingCall?.opportunityId) {
      const opportunity = await recoveryStore.getOpportunity(existingCall.opportunityId);
      if (opportunity && opportunity.tenantId === tenant.tenantId) {
        await recoveryStore.upsertContact(opportunity.contactKey, {
          name: lead.name || undefined,
          phone: lead.callback_number || undefined,
          transactionalSmsAllowed: true,
        });
        const updatedOpportunity = await recoveryStore.patchOpportunity(
          opportunity.id,
          {
            serviceType: lead.service_type || opportunity.serviceType,
            urgency: lead.urgency || opportunity.urgency,
            metadata: {
              ...(opportunity.metadata || {}),
              callId,
              serviceAddress:
                lead.service_address || opportunity.metadata?.serviceAddress || "",
              city: lead.city || opportunity.metadata?.city || "",
              preferredWindow:
                lead.preferred_window || opportunity.metadata?.preferredWindow || "",
              notes: lead.notes || opportunity.metadata?.notes || "",
            },
          }
        );
        recoveryResult = { opportunity: updatedOpportunity, updatedExisting: true };
      }
    }

    if (!recoveryResult) {
      recoveryResult = await engine.ingest({
        idempotencyKey: `phone-lead:${tenant.tenantId}:${callId}`,
        type: "phone_lead",
        source: "ai_phone_operator",
        serviceType: lead.service_type || "",
        urgency: lead.urgency || "",
        contact: {
          name: lead.name || "",
          phone: lead.callback_number || "",
          transactionalSmsAllowed: true,
        },
        metadata: {
          callId,
          serviceAddress: lead.service_address || "",
          city: lead.city || "",
          preferredWindow: lead.preferred_window || "",
          notes: lead.notes || "",
        },
      });
    }

    // Voice capture creates/reuses the CRM contact only. Follow-up tasks are
    // generated by the recovery playbook, preventing duplicate CRM tasks.
    let crmContactId = existingCall?.contactId || null;
    const wix = wixCredentialsForTenant(tenant);
    if (wix && syncCrm) {
      try {
        const contactResult = await createWixContact({
          apiKey: wix.apiKey,
          siteId: wix.siteId,
          lead,
          previousContactId: existingCall?.contactId,
          previousName: existingCall?.lastLead?.name,
          timeoutMs,
          retries,
        });
        crmContactId = contactResult?.contactId || null;
      } catch (error) {
        console.error(JSON.stringify({
          event: "voice.crm_contact_error",
          tenant_id: tenant.tenantId,
          call_id: callId,
          message: String(error?.message || error).slice(0, 400),
        }));
      }
    }

    await state.patchCall(callId, {
      tenantId: tenant.tenantId,
      contactId: crmContactId,
      opportunityId: recoveryResult?.opportunity?.id || null,
      lastLeadAt: Date.now(),
      lastLead: lead,
    });

    console.log(JSON.stringify({
      event: "lead.captured",
      tenant_id: tenant.tenantId,
      ...leadLogSummary(lead),
      crm_contact_id: crmContactId,
      recovery_opportunity_id: recoveryResult?.opportunity?.id || null,
    }));

    return {
      ok: true,
      captured: true,
      crm_synced: Boolean(crmContactId),
      callback_number: lead.callback_number,
      recovery_opportunity_id: recoveryResult?.opportunity?.id || null,
      duplicate_recovery_event: Boolean(recoveryResult?.duplicate),
    };
  }

  if (name === "check_availability") {
    const booking = bookingAdapterForTenant(tenant, { timeoutMs });
    return {
      ok: true,
      ...(await booking.findAvailability({
        serviceType: args.service_type || "",
        preferredWindow: args.preferred_window || "",
        serviceAddress: args.service_address || "",
        city: args.city || "",
        callerNumber,
        tenantId: tenant.tenantId,
      })),
    };
  }

  if (name === "book_appointment") {
    const booking = bookingAdapterForTenant(tenant, { timeoutMs });
    const result = await booking.createBooking({
      name: args.name || "",
      callbackNumber: args.callback_number || callerNumber || "",
      serviceType: args.service_type || "",
      serviceAddress: args.service_address || "",
      city: args.city || "",
      slot: args.slot || "",
      notes: args.notes || "",
      tenantId: tenant.tenantId,
      callId,
    });

    if (result?.confirmed && result?.bookingId) {
      const call = await state.getCall(callId);
      if (call?.opportunityId) {
        await engine.ingest({
          idempotencyKey: `booking:${tenant.tenantId}:${result.bookingId}`,
          type: "booking_confirmed",
          opportunityId: call.opportunityId,
          bookingId: result.bookingId,
          source: "ai_phone_operator",
        });
      }
    }

    return { ok: true, ...result };
  }

  if (name === "transfer_to_human") {
    const target = humanTransferTarget(tenant);
    if (!target) {
      return {
        ok: false,
        transferred: false,
        reason: "human_transfer_number_not_configured",
      };
    }

    transferHold?.start();
    const result = await guardedTransfer({ callId, tenant, target,
      beforeRefer: ({ lead }) => transferCompanion.notifyAndWait({ callId, tenant, target, lead, callerNumber }),
      prepare: async () => {
      const existing = await state.getCall(callId);
      const supplied = args?.context || {};
      const lead = { ...(existing?.lastLead || {}) };
      for (const key of ["name", "service_type"]) {
        if (!lead[key] && supplied[key]) lead[key] = supplied[key];
      }
      await executeTool({ name: "capture_lead", args: lead, callId, callerNumber, tenant, syncCrm: false });
      return lead;
    } });
    if (result.transferred) {
      try { await state.patchCall(callId, { transferId: result.transferId, transferRequested: true }); }
      catch { console.error(JSON.stringify({ event: "transfer.failed", call_id: callId, reason: "state_update_failed" })); }
    }
    return result;
  }

  return { ok: false, reason: `unknown_tool:${name}` };
}

const callLifecycle = createCallLifecycle({
  log: (event, fields) => console.log(JSON.stringify({ event, ...fields })),
  exit: code => process.exit(code),
});

async function attachSideband({
  callId,
  callerNumber,
  tenant,
}) {
  const ws = new WebSocket(
    `wss://api.openai.com/v1/realtime?call_id=${encodeURIComponent(callId)}`,
    { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
  );

  const handledToolCalls = new Set();
  const voiceLog = (event, fields = {}) => console.log(JSON.stringify({ event, tenant_id: tenant.tenantId, call_id: callId, ...fields }));
  const transferHold = createTransferHold({ send: event => send(ws, event), log: voiceLog, restoreTurnDetection: CONVERSATION_TURN_DETECTION });
  const openingAudio = createOpeningAudioMonitor({ log: voiceLog });
  const greetingTurns = createGreetingTurnGuard({ send: event => send(ws, event), log: voiceLog });
  let fallbackStarted = false;
  const greeting = createGreetingWatchdog({
    businessName: tenant.businessName, send: event => send(ws, event), log: voiceLog,
    fallback: async () => {
      greetingTurns.release("greeting_fallback");
      fallbackStarted = true;
      send(ws, { type: "response.cancel" });
      let leadSaved = false;
      try {
        await executeTool({ name: "capture_lead", args: { notes: "Greeting audio unavailable; follow-up needed." }, callId, callerNumber, tenant, syncCrm: false });
        leadSaved = true;
      } catch { voiceLog("greeting.lead_save_failed"); }
      try {
        if (warmTransfer.ready()) {
          const transfer = await warmTransfer.start({ callId, tenant, leadSaved, kind: "greeting_fallback" });
          try { await referRealtimeCall({ apiKey: OPENAI_API_KEY, callId, targetUri: transfer.targetUri }); }
          catch { await warmTransfer.failed(transfer.id); throw new Error("fallback_refer_failed"); }
          ws.close();
          return "twilio_announcement_requested";
        }
        const target = humanTransferTarget(tenant);
        if (!/^\+[1-9]\d{7,14}$/.test(target)) throw new Error("no_fallback_target");
        await referRealtimeCall({ apiKey: OPENAI_API_KEY, callId, targetUri: `tel:${target}` });
        ws.close();
        return "legacy_human_transfer_requested";
      } catch {
        // Last resort: terminate a failed silent session instead of leaving it open.
        try { await hangupRealtimeCall({ apiKey: OPENAI_API_KEY, callId }); }
        finally { ws.close(); }
        return "call_ended_no_audio";
      }
    },
  });

  ws.on("open", () => { openingAudio.open(); greetingTurns.open(); greeting.open(); });

  ws.on("message", async (raw) => {
    let event;
    try {
      event = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (fallbackStarted) return;
    openingAudio.event(event);
    greetingTurns.event(event);
    greeting.event(event);
    transferHold.event(event);


    if (
      logTranscripts &&
      event.type === "response.output_audio_transcript.done"
    ) {
      console.log(JSON.stringify({
        event: "assistant.transcript",
        tenant_id: tenant.tenantId,
        call_id: callId,
        text: event.transcript || "",
      }));
      return;
    }

    if (
      logTranscripts &&
      event.type === "conversation.item.input_audio_transcription.completed"
    ) {
      console.log(JSON.stringify({
        event: "caller.transcript",
        tenant_id: tenant.tenantId,
        call_id: callId,
        text: event.transcript || "",
      }));
      return;
    }

    if (
      event.type === "response.output_item.done" &&
      event.item?.type === "function_call"
    ) {
      const toolCall = event.item;
      const dedupeKey = toolCall.call_id || toolCall.id;
      if (dedupeKey && handledToolCalls.has(dedupeKey)) return;
      if (dedupeKey) handledToolCalls.add(dedupeKey);

      let args = {};
      try {
        args = JSON.parse(toolCall.arguments || "{}");
      } catch {}

      let output;
      if (toolCall.name === "transfer_to_human") greetingTurns.release("human_transfer");
      try {
        output = await executeTool({
          name: toolCall.name,
          args,
          callId,
          callerNumber,
          tenant,
          transferHold,
        });
      } catch (error) {
        console.error(JSON.stringify({
          event: "tool.error",
          tenant_id: tenant.tenantId,
          call_id: callId,
          tool: toolCall.name,
          message: "voice_tool_execution_failed",
        }));
        output = { ok: false, error: "tool_execution_failed" };
      }

      if (toolCall.name === "transfer_to_human" && output.transferred) {
        transferHold.stop();
        greeting.stop();
        try { ws.close(); } catch {}
        return;
      }
      if (toolCall.name === "transfer_to_human") transferHold.stop({ restore: true });

      send(ws, {
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: toolCall.call_id,
          output: JSON.stringify(output),
        },
      });
      send(ws, { type: "response.create" });
      return;
    }

    if (event.type === "error") {
      console.error(JSON.stringify({
        event: "realtime.error",
        tenant_id: tenant.tenantId,
        call_id: callId,
        detail: "realtime_request_failed",
        code: event?.error?.code || "unknown",
      }));
    }
  });

  ws.on("error", (error) => {
    console.error(JSON.stringify({
      event: "sideband.error",
      tenant_id: tenant.tenantId,
      call_id: callId,
      message: "websocket_error",
    }));
  });
  ws.on("close", () => callLifecycle.end(callId));
  ws.on("close", () => { openingAudio.close(); greetingTurns.stop(); greeting.stop(); transferHold.stop(); });
}

async function handleIncomingCall(event) {
  const receivedAt = Date.now();
  const callId = event?.data?.call_id;
  if (!callId) throw new Error("Incoming call webhook had no call_id.");

  const sipHeaders = event?.data?.sip_headers || [];
  const callerNumber = parseSipPhone(sipHeaders);
  const dialedNumber = parseDialedNumber(sipHeaders);
  const tenant = registry.resolveByPhone(dialedNumber);

  if (!tenant) {
    callLifecycle.end(callId);
    console.error(JSON.stringify({
      event: "call.no_tenant_route",
      call_id: callId,
      dialed_number: maskPhone(dialedNumber),
    }));
    await rejectRealtimeCall({
      apiKey: OPENAI_API_KEY,
      callId,
      statusCode: 404,
    });
    return;
  }

  await state.patchCall(callId, {
    tenantId: tenant.tenantId,
    acceptedAt: Date.now(),
    callerHintMasked: maskPhone(callerNumber),
    dialedNumberMasked: maskPhone(dialedNumber),
  });

  const businessContext = localBusinessContext(tenant);
  const instructions = buildOperatorInstructions({
    ...operatorRulesForTenant(tenant),
    companyName: tenant.businessName,
    companyTrade: tenant.trade,
    serviceArea: Array.isArray(tenant.serviceArea)
      ? tenant.serviceArea.join(", ")
      : tenant.serviceArea,
    callerNumber,
    bookingMode: tenant?.policies?.bookingMode || "confirm_only",
    quotePrices: Boolean(tenant?.policies?.quotePrices),
    highValueThreshold: Number(tenant?.economics?.highValueThreshold || 0),
    services: tenant?.services || [],
    localTime: businessContext.localTime,
    businessHoursText: businessContext.businessHoursText,
  });

  await acceptRealtimeCall({
    apiKey: OPENAI_API_KEY,
    callId,
    model: tenant?.integrations?.phone?.model || OPENAI_REALTIME_MODEL,
    instructions,
    voice: tenant?.integrations?.phone?.voice || OPENAI_VOICE,
    tools,
  });

  console.log(JSON.stringify({
    event: "call.accepted",
    acceptance_ms: Date.now() - receivedAt,
    tenant_id: tenant.tenantId,
    call_id: callId,
    caller_hint: maskPhone(callerNumber) || null,
    dialed_number: maskPhone(dialedNumber) || null,
  }));

  await attachSideband({ callId, callerNumber, tenant });
}

const requireIngest = requireBearer(BOOKEDRADAR_INGEST_TOKEN, "ingest_token");
const requireAdmin = requireBearer(BOOKEDRADAR_ADMIN_TOKEN, "admin_token");

app.post("/api/v1/events", requireIngest, requireTenant, async (req, res) => {
  try {
    const event = req.body || {};
    if (!event.type) {
      return res.status(400).json({ ok: false, error: "event.type is required" });
    }
    const result = await engineFor(req.bookedRadarTenant).ingest(event);
    return res.status(201).json({ ok: true, result });
  } catch (error) {
    console.error("Recovery event ingest failed:", error);
    return res.status(500).json({
      ok: false,
      error: String(error?.message || "event_ingest_failed"),
    });
  }
});

for (const kind of [
  "missed-call",
  "web-lead",
  "estimate",
  "cancellation",
  "dormant",
]) {
  app.post(`/api/v1/intake/${kind}`, requireIngest, requireTenant, async (req, res) => {
    try {
      const event = normalizeIntake(kind, req.body || {});
      const result = await engineFor(req.bookedRadarTenant).ingest(event);
      return res.status(201).json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({
        ok: false,
        error: String(error?.message || "invalid_intake"),
      });
    }
  });
}

app.post("/api/v1/intake/reply", requireIngest, requireTenant, async (req, res) => {
  try {
    const tenant = req.bookedRadarTenant;
    const body = req.body || {};

    if (isOptOutText(body.text)) {
      const key = body.contactKey || body.contactId || body.phone || body.email;
      if (!key) {
        return res.status(400).json({
          ok: false,
          error: "contact key/phone/email required for opt-out",
        });
      }
      const result = await engineFor(tenant).ingest({
        idempotencyKey:
          body.idempotencyKey ||
          `optout-reply:${tenant.tenantId}:${body.externalId || key}`,
        type: "contact_opted_out",
        contactKey: key,
        source: body.source || "inbound_reply",
        contact: {
          phone: body.phone || "",
          email: body.email || "",
        },
      });
      return res.json({ ok: true, optOut: true, result });
    }

    if (!body.opportunityId) {
      return res.status(400).json({
        ok: false,
        error: "opportunityId is required for non-opt-out replies",
      });
    }

    const result = await engineFor(tenant).ingest({
      idempotencyKey:
        body.idempotencyKey ||
        `reply:${tenant.tenantId}:${body.externalId || `${Date.now()}-${Math.random()}`}`,
      type: "customer_replied",
      opportunityId: body.opportunityId,
      source: body.source || "inbound_reply",
      contactKey: body.contactKey,
      contact: {
        phone: body.phone || "",
        email: body.email || "",
      },
      metadata: {
        text: String(body.text || "").slice(0, 2000),
      },
    });
    return res.json({ ok: true, result });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error: String(error?.message || "reply_intake_failed"),
    });
  }
});

app.get("/api/v1/actions/due", requireAdmin, requireTenant, async (req, res) => {
  try {
    const tenant = req.bookedRadarTenant;
    const now = req.query.now ? new Date(String(req.query.now)) : new Date();
    const actions = await engineFor(tenant).dueActions(now);
    const hydrated = [];

    for (const action of actions) {
      const contact = await recoveryStore.getContact(action.contactKey);
      const opportunity = await recoveryStore.getOpportunity(action.opportunityId);
      hydrated.push({
        ...action,
        message:
          ["sms", "email"].includes(action.channel)
            ? renderTemplate(action.template, { contact, tenant, opportunity })
            : null,
      });
    }

    return res.json({ ok: true, tenantId: tenant.tenantId, actions: hydrated });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "due_action_query_failed" });
  }
});

app.post("/api/v1/actions/:id/complete", requireAdmin, requireTenant, async (req, res) => {
  try {
    const existing = (await recoveryStore.snapshot()).actions[req.params.id];
    if (!existing || existing.tenantId !== req.bookedRadarTenant.tenantId) {
      return res.status(404).json({ ok: false, error: "action_not_found" });
    }

    const action = await recoveryStore.patchAction(req.params.id, {
      status: req.body?.status || "completed",
      completedAt: new Date().toISOString(),
      result: req.body?.result || null,
    });
    return res.json({ ok: true, action });
  } catch (error) {
    return res.status(404).json({ ok: false, error: "action_not_found" });
  }
});

app.post("/api/v1/opportunities/:id/recovered", requireAdmin, requireTenant, async (req, res) => {
  try {
    const result = await engineFor(req.bookedRadarTenant).markRecovered(
      req.params.id,
      {
        bookingId: req.body?.bookingId || null,
        estimatedRecoveredValue: req.body?.estimatedRecoveredValue ?? null,
      }
    );
    return res.json({ ok: true, result });
  } catch (error) {
    return res.status(404).json({
      ok: false,
      error: String(error?.message || "opportunity_not_found"),
    });
  }
});

app.post("/api/v1/opportunities/:id/revenue", requireAdmin, requireTenant, async (req, res) => {
  try {
    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      return res.status(400).json({
        ok: false,
        error: "amount must be a non-negative number",
      });
    }

    const result = await engineFor(req.bookedRadarTenant).ingest({
      idempotencyKey:
        req.body?.idempotencyKey ||
        `revenue:${req.bookedRadarTenant.tenantId}:${req.params.id}:${req.body?.source || "manual"}:${amount}`,
      type: "revenue_confirmed",
      opportunityId: req.params.id,
      amount,
      source: req.body?.source || "authorized_confirmation",
    });
    return res.json({ ok: true, result });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error: String(error?.message || "revenue_confirmation_failed"),
    });
  }
});

app.post("/api/v1/contacts/:key/opt-out", requireAdmin, requireTenant, async (req, res) => {
  try {
    const result = await engineFor(req.bookedRadarTenant).ingest({
      idempotencyKey:
        req.body?.idempotencyKey ||
        `optout:${req.bookedRadarTenant.tenantId}:${req.params.key}`,
      type: "contact_opted_out",
      contactKey: req.params.key,
      source: req.body?.source || "customer_request",
      contact: req.body?.contact || {},
    });
    return res.json({ ok: true, result });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "opt_out_failed" });
  }
});

app.get("/api/v1/actions/failed", requireAdmin, requireTenant, async (req, res) => {
  const actions = await recoveryStore.failedActions(req.bookedRadarTenant.tenantId);
  return res.json({ ok: true, tenantId: req.bookedRadarTenant.tenantId, actions });
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
    return res.json({
      ok: true,
      tenantId: tenant.tenantId,
      report: await radarProof(recoveryStore, tenant.tenantId),
    });
  } catch {
    return res.status(500).json({ ok: false, error: "radarproof_failed" });
  }
});

app.use("/dashboard", express.static("public"));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "bookedradar-platform",
    version: "2.0.0",
    billingMode: billing ? 'test' : 'disabled',
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
    })),
    voice: {
      enabled: voiceEnabled,
      apiKeyConfigured: Boolean(OPENAI_API_KEY),
      webhookSecretConfigured: Boolean(OPENAI_WEBHOOK_SECRET),
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
    handleIncomingCall(event).catch((error) => {
      callLifecycle.end(callId);
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

if (dispatchIntervalSeconds > 0) {
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
