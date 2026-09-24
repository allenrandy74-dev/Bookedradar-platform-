import { tenantReadiness } from "./readiness.js";
import { deployableCapabilities, serviceProfile } from "./service-profiles.js";

const LABELS = Object.freeze({
  callerMemory: "Returning-caller memory",
  spamScreening: "Spam / solicitor screening",
  transcriptHistory: "Searchable transcript history",
  callerTexting: "In-call transactional texting",
  twoWaySms: "Two-way SMS continuity",
  webChat: "Embeddable web chat",
  knowledgeGapLearning: "Knowledge Gap Radar",
  membershipRadar: "Membership Radar",
  noShowGuard: "No-Show Guard",
  reviewRadar: "Review Radar",
});

function pendingReason(key, tenant) {
  if (key === "transcriptHistory" && tenant?.policies?.transcriptRetentionApproved !== true) {
    return "customer transcript-retention approval required";
  }
  if (["callerTexting", "twoWaySms", "noShowGuard"].includes(key) && tenant?.integrations?.sms?.enabled !== true) {
    return "approved tenant SMS provider/A2P activation required";
  }
  if (key === "webChat" && tenant?.integrations?.webChat?.enabled !== true) {
    return "approved website origin and web-chat activation required";
  }
  return "feature acceptance/activation required";
}

export function deploymentPlan(tenant, { env = process.env, foundingPartner = true } = {}) {
  const profileId = String(tenant?.commercial?.serviceProfile || "").trim().toLowerCase();
  const profile = serviceProfile(profileId);
  const readiness = tenantReadiness(tenant, { env });
  const actual = deployableCapabilities(tenant);
  const entitlements = tenant?.commercial?.entitlements || profile.features || {};
  const price = foundingPartner
    ? {
        monthlyUsd: profile.pricing.foundingMonthlyUsd,
        setupUsd: profile.pricing.foundingSetupUsd,
        label: "Founding Partner",
      }
    : {
        monthlyUsd: profile.pricing.monthlyUsd,
        setupUsd: profile.pricing.standardSetupUsd,
        label: "Standard",
      };

  const features = [];
  for (const [key, label] of Object.entries(LABELS)) {
    const included = entitlements[key] === true;
    if (!included) {
      features.push({ key, label, included: false, status: "NOT_INCLUDED" });
      continue;
    }

    const active =
      key === "transcriptHistory" ? actual.transcriptHistory :
      key === "callerTexting" ? actual.callerTexting :
      key === "twoWaySms" ? actual.twoWaySms :
      key === "webChat" ? actual.webChat :
      key === "noShowGuard" ? actual.noShowGuard :
      tenant?.features?.[key] === true;

    features.push({
      key,
      label,
      included: true,
      status: active ? "ACTIVE" : "GATED",
      ...(active ? {} : { reason: pendingReason(key, tenant) }),
    });
  }

  const core = [
    { key: "voice", label: "AI answering / intake", active: actual.voice },
    { key: "humanTransfer", label: "Human escalation / transfer", active: readiness.checks.some(x => x.code === "human_escalation" && x.ok) },
    { key: "crm", label: "CRM integration", active: actual.crm },
    { key: "email", label: "Transactional email", active: actual.email },
    { key: "bilingual", label: "English / Spanish handling", active: actual.bilingualEnglishSpanish },
    { key: "radarProof", label: "RadarProof / Revenue Leak Radar / Owner Brief", active: true },
  ];

  const liveBookingEntitled = profile.id === "schedule";
  const liveBooking = {
    included: liveBookingEntitled,
    active: liveBookingEntitled && actual.liveBooking,
    status: !liveBookingEntitled
      ? "NOT_INCLUDED"
      : actual.liveBooking
        ? "ACTIVE"
        : "GATED",
    ...(
      liveBookingEntitled && !actual.liveBooking
        ? { reason: "separate scheduling approval, agreement reference, calendar credentials and acceptance test required" }
        : {}
    ),
  };

  const requiredBlockers = readiness.blockers.map(item => ({
    code: item.code,
    message: item.message,
  }));

  return {
    generatedAt: new Date().toISOString(),
    tenantId: tenant?.tenantId || null,
    businessName: tenant?.businessName || null,
    package: {
      id: profile.id,
      name: profile.name,
      pricing: price,
    },
    core,
    features,
    liveBooking,
    readiness: {
      ready: readiness.ready,
      status: readiness.status,
      blockers: requiredBlockers,
      warnings: readiness.warnings,
    },
    deploymentDecision: readiness.ready ? "CORE_READY_FOR_ACCEPTANCE_TEST" : "BLOCKED",
    rule:
      "Only activate capabilities marked ACTIVE and acceptance-tested for this tenant. Entitled but gated capabilities must remain disabled until their specific provider, consent, commercial and acceptance requirements pass.",
  };
}
