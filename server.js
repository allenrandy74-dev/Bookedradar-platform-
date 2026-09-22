import "dotenv/config";
import path from "node:path";
import { createGreetingWatchdog } from "./src/greeting-watchdog.js";
import { createWarmTransfer } from "./src/warm-transfer.js";
import express from "express";
import OpenAI from "openai";
import WebSocket from "ws";

import {
  acceptRealtimeCall,
  referRealtimeCall,
  rejectRealtimeCall,
  hangupRealtimeCall,
} from "./src/openai-call.js";
import { appendLead } from "./src/lead-store.js";
import {
  buildOperatorInstructions,
  normalizeLead,
  parseSipPhone,
  parseDialedNumber,
  tools,
} from "./src/operator.js";
import { createWixContact } from "./src/wix.js";
import { RecoveryStore } from "./src/recovery/store.js";
import { RecoveryEngine } from "./src/recovery/engine.js";
import { radarProof } from "./src/recovery/radarproof.js";
import { renderTemplate } from "./src/recovery/templates.js";
import { TenantRegistry } from "./src/recovery/tenant-registry.js";
import { requireBearer } from "./src/auth.js";
import { ActionDispatcher } from "./src/integrations/dispatcher.js";
import {
  buildTenantAdapters,
  wixCredentialsForTenant,
  bookingAdapterForTenant,
} from "./src/integrations/tenant-adapters.js";
import { normalizeIntake, isOptOutText } from "./src/intake.js";
import { JsonStateStore } from "./src/state-store.js";
import { leadLogSummary, maskPhone } from "./src/privacy.js";

const {
  PORT = "5050",
  OPENAI_API_KEY = "",
  OPENAI_WEBHOOK_SECRET = "",
  OPENAI_REALTIME_MODEL = "gpt-realtime-2.1",
  OPENAI_VOICE = "marin",
  HUMAN_TRANSFER_NUMBER = "",
  WARM_TRANSFER_ENABLED = "false",
  WARM_TRANSFER_SIP_DOMAIN = "",
  VOICE_PUBLIC_BASE_URL = "",
  TWILIO_ACCOUNT_SID = "",
  TWILIO_AUTH_TOKEN = "",
  TWILIO_VOICE_CALLER_ID = "",
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
app.use(express.json({ limit: "256kb" }));

const state = new JsonStateStore(STATE_FILE);
await state.load();

const recoveryStore = new RecoveryStore(RECOVERY_STATE_FILE);
await recoveryStore.load();

const registry = await TenantRegistry.loadDirectory(TENANT_CONFIG_DIR);
const transferStore = new JsonStateStore(path.join(path.dirname(STATE_FILE), "voice-transfers.json"));
await transferStore.load();
const warmTransfer = createWarmTransfer({
  store: transferStore, registry,
  config: { enabled: WARM_TRANSFER_ENABLED === "true", domain: WARM_TRANSFER_SIP_DOMAIN,
    baseUrl: VOICE_PUBLIC_BASE_URL, accountSid: TWILIO_ACCOUNT_SID,
    authToken: TWILIO_AUTH_TOKEN, callerId: TWILIO_VOICE_CALLER_ID },
  log: (event, fields) => console.log(JSON.stringify({ event, ...fields })),
});
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
          workerId: `bookedradar-${tenant.tenantId}-${process.pid}`,
        }),
      }
    );
  }
  return dispatchers.get(tenant.tenantId);
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
}) {
  const engine = engineFor(tenant);

  if (name === "capture_lead") {
    const lead = normalizeLead(args, {
      call_id: callId,
      caller_number: callerNumber,
    });

    await appendLead(LEADS_FILE, {
      ...lead,
      tenant_id: tenant.tenantId,
    });

    const existingCall = await state.getCall(callId);
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
    const target = String(HUMAN_TRANSFER_NUMBER || tenant?.escalation?.humanPhone || "").trim();
    if (!target) {
      return {
        ok: false,
        transferred: false,
        reason: "human_transfer_number_not_configured",
      };
    }

    // Save the latest known context before relinquishing the AI leg.
    const existing = await state.getCall(callId);
    const supplied = args?.context || {};
    const lead = { ...(existing?.lastLead || {}) };
    for (const key of ["name", "service_type", "urgency", "preferred_window"]) {
      if (supplied[key]) lead[key] = supplied[key];
    }
    await executeTool({ name: "capture_lead", args: lead, callId, callerNumber, tenant, syncCrm: false });
    if (warmTransfer.ready()) {
      const transfer = await warmTransfer.start({ callId, tenant, target, lead, leadSaved: true });
      try {
        await referRealtimeCall({ apiKey: OPENAI_API_KEY, callId, targetUri: transfer.targetUri });
      } catch {
        await warmTransfer.failed(transfer.id);
        // Never dial a second, unscreened leg after an ambiguous REFER result.
        return { ok: false, transferred: false, lead_saved: true, reason: "screened_transfer_failed" };
      }
      await state.patchCall(callId, { transferId: transfer.id, transferRequested: true });
      return { ok: true, transferred: true, status: "screening_requested" };
    }
    // Keep the proven path until the separately configured relay is verified.
    console.log(JSON.stringify({ event: "transfer.requested", tenant_id: tenant.tenantId, call_id: callId, mode: "legacy" }));
    await referRealtimeCall({ apiKey: OPENAI_API_KEY, callId, targetUri: `tel:${target}` });
    console.log(JSON.stringify({ event: "call.transfer.referred", tenant_id: tenant.tenantId, call_id: callId, mode: "legacy" }));
    await state.patchCall(callId, { tenantId: tenant.tenantId, transferRequested: true });
    return { ok: true, transferred: true, status: "legacy_referred" };
  }

  return { ok: false, reason: `unknown_tool:${name}` };
}

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
  let fallbackStarted = false;
  const greeting = createGreetingWatchdog({
    businessName: tenant.businessName, send: event => send(ws, event), log: voiceLog,
    fallback: async () => {
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
        const target = String(HUMAN_TRANSFER_NUMBER || tenant?.escalation?.humanPhone || "").trim();
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

  ws.on("open", () => greeting.open());

  ws.on("message", async (raw) => {
    let event;
    try {
      event = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (fallbackStarted) return;
    greeting.event(event);


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
      try {
        output = await executeTool({
          name: toolCall.name,
          args,
          callId,
          callerNumber,
          tenant,
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
        greeting.stop();
        try { ws.close(); } catch {}
        return;
      }

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
}

async function handleIncomingCall(event) {
  const callId = event?.data?.call_id;
  if (!callId) throw new Error("Incoming call webhook had no call_id.");

  const sipHeaders = event?.data?.sip_headers || [];
  const callerNumber = parseSipPhone(sipHeaders);
  const dialedNumber = parseDialedNumber(sipHeaders);
  const tenant = registry.resolve({ phone: dialedNumber });

  if (!tenant) {
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
    voiceReliabilityRevision: "2026-09-22.1",
    screenedTransferReady: warmTransfer.ready(),
    tenants: registry.list().length,
    voiceEnabled,
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

  const webhookId = req.header("webhook-id") || event?.id;
  if (!(await state.markWebhookOnce(webhookId))) {
    return res.status(200).send("duplicate ignored");
  }

  res.status(200).send("ok");

  if (event.type === "realtime.call.incoming") {
    handleIncomingCall(event).catch((error) => {
      console.error(JSON.stringify({
        event: "incoming_call.failed",
        call_id: event?.data?.call_id || null,
        message: String(error?.message || error).slice(0, 400),
      }));
    });
  }
});

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
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
