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
  const priorFeatures = next.features || {};

  // Entitlements describe what the customer bought. Active feature flags describe
  // what has actually passed provider/consent acceptance and may run now.
  next.commercial = {
    ...(next.commercial || {}),
    serviceProfile: profile.id,
    serviceProfileName: profile.name,
    serviceTier: profile.id === "schedule" ? "scheduling" : "founding_partner_pilot",
    entitlements: clone(profile.features),
    pricing: clone(profile.pricing),
  };

  next.features = {
    ...priorFeatures,
    callerMemory: profile.features.callerMemory === true,
    spamScreening: profile.features.spamScreening === true,
    knowledgeGapLearning: profile.features.knowledgeGapLearning === true,
    reviewRadar: profile.features.reviewRadar === true,
    membershipRadar: profile.features.membershipRadar === true,
    languages: clone(profile.features.languages || ["en"]),
    // Provider / consent dependent features remain off until explicitly activated.
    transcriptHistory:
      profile.features.transcriptHistory === true &&
      priorFeatures.transcriptHistory === true &&
      next.policies?.transcriptRetentionApproved === true,
    callerTexting:
      profile.features.callerTexting === true &&
      priorFeatures.callerTexting === true &&
      next.integrations?.sms?.enabled === true,
    twoWaySms:
      profile.features.twoWaySms === true &&
      priorFeatures.twoWaySms === true &&
      next.integrations?.sms?.enabled === true,
    webChat:
      profile.features.webChat === true &&
      priorFeatures.webChat === true &&
      next.integrations?.webChat?.enabled === true,
    noShowGuard:
      profile.features.noShowGuard === true &&
      priorFeatures.noShowGuard === true &&
      next.integrations?.sms?.enabled === true,
  };

  next.policies = {
    ...(next.policies || {}),
    recordCalls: false,
    bookingMode: next.policies?.bookingMode || profile.policies.bookingMode,
    transcriptRetentionApproved: next.policies?.transcriptRetentionApproved === true,
  };

  next.integrations ??= {};
  next.integrations.sms = {
    type: next.integrations.sms?.type || "twilio",
    ...(next.integrations.sms || {}),
  };
  next.integrations.webChat = {
    ...(next.integrations.webChat || {}),
    allowedOrigins: Array.isArray(next.integrations.webChat?.allowedOrigins)
      ? next.integrations.webChat.allowedOrigins
      : [],
  };
  next.integrations.calendar = {
    ...(next.integrations.calendar || {}),
  };

  // Never allow live booking merely because RadarSchedule was selected.
  if (next.policies.bookingMode !== "live_booking") {
    next.integrations.calendar.enabled = false;
  }

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
