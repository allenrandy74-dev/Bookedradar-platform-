function clean(value, max = 400) {
  return String(value ?? "").trim().slice(0, max);
}

const SUPPORTED_LANGUAGES = new Set(["en", "es"]);

export function competitiveFeaturesForTenant(tenant = {}) {
  const features = tenant?.features || {};
  const requested = Array.isArray(features.languages) ? features.languages : ["en"];
  const languages = [...new Set(requested.map(value => clean(value, 12).toLowerCase()).filter(value => SUPPORTED_LANGUAGES.has(value)))];
  if (!languages.length) languages.push("en");
  return {
    callerMemory: features.callerMemory === true,
    spamScreening: features.spamScreening === true,
    transcriptHistory:
      features.transcriptHistory === true &&
      tenant?.policies?.transcriptRetentionApproved === true,
    callerTexting: features.callerTexting === true,
    twoWaySms: features.twoWaySms === true,
    languages,
  };
}

export function inputTranscriptionForTenant(tenant = {}) {
  const features = competitiveFeaturesForTenant(tenant);
  if (!features.transcriptHistory) return null;
  return {
    model: "gpt-transcribe",
    languages: features.languages,
  };
}

export async function returningCallerContext({ store, tenant, callerNumber }) {
  const features = competitiveFeaturesForTenant(tenant);
  if (!features.callerMemory || !/^\+[1-9]\d{7,14}$/.test(String(callerNumber || ""))) return "";

  const contactKey = `${tenant.tenantId}:${callerNumber}`;
  const contact = await store.getContact(contactKey);
  if (!contact) return "";

  const snapshot = await store.snapshot();
  const recent = Object.values(snapshot.opportunities || {})
    .filter(item => item.tenantId === tenant.tenantId && item.contactKey === contactKey)
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))[0];

  const name = clean(contact.name || [contact.firstName, contact.lastName].filter(Boolean).join(" "), 120);
  const lastService = clean(recent?.serviceType, 160);
  if (!name && !lastService) return "";

  return [
    "A POSSIBLE returning-caller record matches the network caller-number hint.",
    name ? `Stored name: ${name}.` : "",
    lastService ? `Most recent service category: ${lastService}.` : "",
    "Caller ID is not identity proof. Do not reveal prior private details or assume this is the same person.",
    "Verify the caller's name naturally first. Use prior context only after the caller confirms the identity, and still confirm the current service address and current request.",
  ].filter(Boolean).join(" ");
}

export function competitiveFeatureGuidance(tenant = {}, { returningCaller = "" } = {}) {
  const features = competitiveFeaturesForTenant(tenant);
  const guidance = [];

  if (features.languages.includes("es")) {
    guidance.push(
      "BILINGUAL HANDLING: English and Spanish are approved. If the caller speaks Spanish, continue naturally in Spanish. Match the caller's language without making them ask twice. Preserve names, addresses, numbers, and customer-provided wording accurately rather than translating or guessing them."
    );
  }

  if (features.spamScreening) {
    guidance.push(
      "SPAM / SOLICITOR SCREENING: If the caller is clearly an automated robocall, mass telemarketer, or unrelated sales solicitation, politely say the business does not accept solicitation calls and use end_call. Never classify a caller as spam from caller ID, accent, language, hesitation, or missing information alone. Customers, prospective customers, vendors with legitimate business, applicants, complaints, and uncertain callers must continue through normal handling."
    );
  }

  if (returningCaller) guidance.push(`RETURNING CALLER MEMORY: ${returningCaller}`);

  if (features.transcriptHistory) {
    guidance.push(
      "TRANSCRIPT HISTORY: This tenant has approved text transcript retention for quality and call-history purposes. Do not ask for or repeat unnecessary sensitive information. Recording audio is a separate policy and is not implied by transcript retention."
    );
  }

  if (features.callerTexting && tenant?.integrations?.sms?.enabled === true) {
    guidance.push(
      "IN-CALL TEXTING: If the caller asks you to text approved transactional information such as a scheduling link, directions, or a business-provided resource, you may use send_caller_text. Confirm the callback number first. Never use this tool for marketing, unsolicited promotions, passwords, payment-card data, or invented information."
    );
  }

  return guidance.join("\n");
}

export const sendCallerTextTool = {
  type: "function",
  name: "send_caller_text",
  description: "Send approved transactional information to the current caller by SMS when the tenant SMS channel is enabled.",
  parameters: {
    type: "object",
    properties: {
      content: {
        type: "string",
        description: "Short approved transactional message requested or useful in the current service conversation. Never include sensitive payment data or marketing.",
      },
    },
    required: ["content"],
    additionalProperties: false,
  },
};

export const endCallTool = {
  type: "function",
  name: "end_call",
  description: "Politely end a clearly identified spam, robocall, or unrelated sales-solicitation call when tenant spam screening is enabled.",
  parameters: {
    type: "object",
    properties: {
      reason: {
        type: "string",
        description: "Brief non-sensitive reason such as robocall or unrelated_sales_solicitation.",
      },
    },
    required: ["reason"],
    additionalProperties: false,
  },
};

export function toolsForTenant(baseTools, tenant = {}) {
  const features = competitiveFeaturesForTenant(tenant);
  const extra = [];
  if (features.callerTexting && tenant?.integrations?.sms?.enabled === true) {
    extra.push(sendCallerTextTool);
  }
  if (features.spamScreening) extra.push(endCallTool);
  return [...baseTools, ...extra];
}
