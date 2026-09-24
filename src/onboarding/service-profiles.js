const clone = value => JSON.parse(JSON.stringify(value));

export const SERVICE_PROFILES = Object.freeze({
  answer: Object.freeze({
    id: "answer",
    name: "RadarAnswer",
    description: "AI answering, intake, escalation and owner visibility without automated recovery outreach.",
    pricing: { monthlyUsd: 149, standardSetupUsd: 199, foundingMonthlyUsd: 149, foundingSetupUsd: 0 },
    features: Object.freeze({
      callerMemory: true,
      spamScreening: true,
      transcriptHistory: false,
      callerTexting: false,
      twoWaySms: false,
      webChat: false,
      knowledgeGapLearning: true,
      membershipRadar: false,
      noShowGuard: false,
      reviewRadar: false,
      languages: ["en", "es"],
    }),
    integrations: Object.freeze({
      smsEnabled: false,
      webChatEnabled: false,
      calendarEnabled: false,
    }),
    policies: Object.freeze({
      bookingMode: "confirm_only",
      recordCalls: false,
      transcriptRetentionApproved: false,
    }),
  }),
  recover: Object.freeze({
    id: "recover",
    name: "RadarRecover",
    description: "Voice + recovery + owner intelligence, with optional web chat and approved messaging.",
    pricing: { monthlyUsd: 497, standardSetupUsd: 499, foundingMonthlyUsd: 397, foundingSetupUsd: 0 },
    features: Object.freeze({
      callerMemory: true,
      spamScreening: true,
      transcriptHistory: false,
      callerTexting: true,
      twoWaySms: true,
      webChat: true,
      knowledgeGapLearning: true,
      membershipRadar: false,
      noShowGuard: false,
      reviewRadar: true,
      languages: ["en", "es"],
    }),
    integrations: Object.freeze({
      smsEnabled: false,
      webChatEnabled: false,
      calendarEnabled: false,
    }),
    policies: Object.freeze({
      bookingMode: "confirm_only",
      recordCalls: false,
      transcriptRetentionApproved: false,
    }),
  }),
  grow: Object.freeze({
    id: "grow",
    name: "RadarGrow",
    description: "Recovery plus memberships, no-show prevention and review intelligence after the required provider/consent checks.",
    pricing: { monthlyUsd: 697, standardSetupUsd: 749, foundingMonthlyUsd: 597, foundingSetupUsd: 0 },
    features: Object.freeze({
      callerMemory: true,
      spamScreening: true,
      transcriptHistory: false,
      callerTexting: true,
      twoWaySms: true,
      webChat: true,
      knowledgeGapLearning: true,
      membershipRadar: true,
      noShowGuard: true,
      reviewRadar: true,
      languages: ["en", "es"],
    }),
    integrations: Object.freeze({
      smsEnabled: false,
      webChatEnabled: false,
      calendarEnabled: false,
    }),
    policies: Object.freeze({
      bookingMode: "confirm_only",
      recordCalls: false,
      transcriptRetentionApproved: false,
    }),
  }),
  schedule: Object.freeze({
    id: "schedule",
    name: "RadarSchedule",
    description: "Recovery plus separately approved live calendar booking; full dispatch remains a different custom scope.",
    pricing: { monthlyUsd: 897, standardSetupUsd: 999, foundingMonthlyUsd: 797, foundingSetupUsd: 0 },
    features: Object.freeze({
      callerMemory: true,
      spamScreening: true,
      transcriptHistory: false,
      callerTexting: true,
      twoWaySms: true,
      webChat: true,
      knowledgeGapLearning: true,
      membershipRadar: false,
      noShowGuard: false,
      reviewRadar: true,
      languages: ["en", "es"],
    }),
    integrations: Object.freeze({
      smsEnabled: false,
      webChatEnabled: false,
      calendarEnabled: false,
    }),
    policies: Object.freeze({
      bookingMode: "confirm_only",
      recordCalls: false,
      transcriptRetentionApproved: false,
    }),
  }),
});

export function serviceProfile(id = "recover") {
  const key = String(id || "recover").trim().toLowerCase();
  const profile = SERVICE_PROFILES[key];
  if (!profile) throw new Error(`Unknown BookedRadar service profile: ${id}`);
  return clone(profile);
}

export function applyServiceProfile(tenant, profileId = "recover") {
  const profile = serviceProfile(profileId);
  const next = clone(tenant || {});
  next.features = { ...(next.features || {}), ...profile.features };
  next.policies = { ...(next.policies || {}), ...profile.policies };

  next.integrations ??= {};
  next.integrations.sms = {
    type: next.integrations.sms?.type || "twilio",
    ...(next.integrations.sms || {}),
    enabled: profile.integrations.smsEnabled === true && next.integrations.sms?.enabled === true,
  };
  next.integrations.webChat = {
    ...(next.integrations.webChat || {}),
    enabled: profile.integrations.webChatEnabled === true && next.integrations.webChat?.enabled === true,
    allowedOrigins: Array.isArray(next.integrations.webChat?.allowedOrigins)
      ? next.integrations.webChat.allowedOrigins
      : [],
  };
  next.integrations.calendar = {
    ...(next.integrations.calendar || {}),
    enabled: profile.integrations.calendarEnabled === true && next.integrations.calendar?.enabled === true,
  };

  next.commercial = {
    ...(next.commercial || {}),
    serviceProfile: profile.id,
    serviceProfileName: profile.name,
  };

  // Provider-dependent and consent-dependent capabilities always fail closed.
  if (next.integrations.sms.enabled !== true) {
    next.features.callerTexting = false;
    next.features.twoWaySms = false;
    next.features.noShowGuard = false;
  }
  if (next.integrations.webChat.enabled !== true) next.features.webChat = false;
  if (next.policies.transcriptRetentionApproved !== true) next.features.transcriptHistory = false;
  if (next.policies.bookingMode !== "live_booking") next.integrations.calendar.enabled = false;

  return next;
}

export function deployableCapabilities(tenant = {}) {
  const features = tenant.features || {};
  const integrations = tenant.integrations || {};
  return {
    voice: integrations.phone?.enabled === true,
    crm: integrations.crm?.enabled === true,
    email: integrations.email?.enabled === true,
    callerMemory: features.callerMemory === true,
    spamScreening: features.spamScreening === true,
    bilingualEnglishSpanish: Array.isArray(features.languages) &&
      features.languages.includes("en") && features.languages.includes("es"),
    knowledgeGapRadar: features.knowledgeGapLearning === true,
    reviewRadar: features.reviewRadar === true,
    transcriptHistory: features.transcriptHistory === true &&
      tenant.policies?.transcriptRetentionApproved === true,
    webChat: features.webChat === true && integrations.webChat?.enabled === true,
    twoWaySms: features.twoWaySms === true && integrations.sms?.enabled === true,
    callerTexting: features.callerTexting === true && integrations.sms?.enabled === true,
    noShowGuard: features.noShowGuard === true && integrations.sms?.enabled === true,
    membershipRadar: features.membershipRadar === true,
    liveBooking: tenant.policies?.bookingMode === "live_booking" &&
      integrations.calendar?.enabled === true &&
      tenant.commercial?.schedulingApproved === true,
  };
}
