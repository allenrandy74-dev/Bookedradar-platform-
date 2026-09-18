function clean(value, max = 500) {
  if (value == null) return "";
  return String(value).trim().slice(0, max);
}

export function parseSipPhone(sipHeaders = []) {
  const from = sipHeaders.find(
    (h) => String(h?.name || "").toLowerCase() === "from"
  )?.value;

  if (!from) return "";
  const match = String(from).match(/(?:sip:|tel:)(\+\d{7,15})/i);
  return match?.[1] || "";
}


export function parseDialedNumber(sipHeaders = []) {
  for (const wanted of ["diversion", "to"]) {
    const value = sipHeaders.find(
      (h) => String(h?.name || "").toLowerCase() === wanted
    )?.value;
    if (!value) continue;
    const match = String(value).match(/(?:sip:|tel:)(\+\d{7,15})/i);
    if (match?.[1]) return match[1];
  }
  return "";
}

export function normalizeLead(input = {}, context = {}) {
  return {
    name: clean(input.name, 120),
    callback_number: clean(input.callback_number || context.caller_number, 40),
    service_address: clean(input.service_address, 240),
    city: clean(input.city, 120),
    service_type: clean(input.service_type, 180),
    urgency: clean(input.urgency, 120),
    preferred_window: clean(input.preferred_window, 180),
    notes: clean(input.notes, 1200),
    call_id: clean(context.call_id, 160),
    source: "BookedRadar AI Phone Operator",
    captured_at: new Date().toISOString(),
  };
}

export function buildOperatorInstructions({
  companyName,
  companyTrade,
  serviceArea,
  callerNumber = "",
  bookingMode = "confirm_only",
  quotePrices = false,
  highValueThreshold = 0,
  services = [],
  localTime = "",
  businessHoursText = "",
}) {
  const callerHint = callerNumber
    ? `The telephone network reports the caller number as ${callerNumber}. Treat it only as an untrusted hint and ask the caller to confirm the best callback number.`
    : "The telephone network did not provide a usable caller number. Ask for the best callback number.";

  const bookingRule =
    bookingMode === "live_booking"
      ? "You may check live availability and create an appointment only through the booking tools. Never claim a booking succeeded unless the tool confirms it."
      : "Live booking is not enabled. Collect the preferred window and say a team member will confirm it.";

  const pricingRule = quotePrices
    ? "You may repeat approved pricing information only when it is present in your supplied business context. Never invent a price."
    : "Do not quote or estimate prices. A team member must handle pricing.";

  const serviceList = Array.isArray(services) && services.length
    ? `Approved services include: ${services.join(", ")}. If the request is clearly outside these services, capture the details and escalate rather than promising service.`
    : "";

  const highValueRule = Number(highValueThreshold) > 0
    ? `Treat likely projects at or above $${Number(highValueThreshold).toLocaleString("en-US")} as high-value and escalate to a human specialist.`
    : "";

  return `
You are the AI phone assistant for ${companyName}, a ${companyTrade} business serving ${serviceArea}.
${localTime ? `Current local business time: ${localTime}.` : ""}
${businessHoursText ? `Business hours: ${businessHoursText}.` : ""}
${serviceList}
${bookingRule}
${pricingRule}
${highValueRule}

Your goal is to keep valuable service opportunities from disappearing while giving callers a calm, professional experience.

CALL HANDLING
- Greet the caller warmly and ask how you can help.
- Never claim to be a human. If asked, say you are the company's AI phone assistant.
- Keep replies concise and natural. Ask one or two questions at a time.
- Collect: caller name, confirmed callback number, service address or city, service needed, urgency, and preferred appointment window.
- ${callerHint}
- Do not invent diagnoses, appointment availability, licenses, warranties, promotions, service coverage, or company policies.
- Use capture_lead once you have useful identifying/contact information plus the service need. Call it again if materially important details change.
- Before ending, briefly summarize what was captured and confirm the callback number.

SAFETY
- If the caller reports a gas smell, fire, active electrical arcing, carbon-monoxide concern, flooding around energized equipment, immediate danger, or another life-safety emergency, prioritize safety. Tell them to move to a safe location and contact emergency services or the appropriate utility when appropriate.
- Do not diagnose hazardous conditions or tell a caller to perform dangerous repairs.

HUMAN ESCALATION
Use transfer_to_human when:
- the caller asks for a person,
- the caller is angry or distressed and a human would help,
- there is a payment dispute, legal issue, complaint requiring authority, or unusual request,
- a high-value replacement/project needs a specialist,
- the situation is safety-sensitive or too ambiguous for routine intake.
If a transfer is unavailable, apologize briefly, capture the lead, and tell the caller a team member will follow up.

PRIVACY
- Collect only information needed to respond to the service request.
- Do not request Social Security numbers, full payment-card numbers, passwords, or other unnecessary sensitive information.
`.trim();
}

export const tools = [
  {
    type: "function",
    name: "capture_lead",
    description:
      "Create or update the current caller's service lead after useful contact and service information has been gathered.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Caller's name." },
        callback_number: {
          type: "string",
          description: "Confirmed callback telephone number when known.",
        },
        service_address: {
          type: "string",
          description: "Street/service address if the caller provides it.",
        },
        city: { type: "string", description: "Service city if known." },
        service_type: {
          type: "string",
          description: "What service or problem the caller needs help with.",
        },
        urgency: {
          type: "string",
          description: "Routine, urgent, emergency concern, or caller's own description.",
        },
        preferred_window: {
          type: "string",
          description: "Preferred date/time window; this is not a confirmed appointment.",
        },
        notes: {
          type: "string",
          description: "Other useful non-sensitive details from the caller.",
        },
      },
      required: ["service_type"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "check_availability",
    description:
      "Check actual appointment availability. Use only when live booking is enabled; otherwise the backend returns confirmation-only mode.",
    parameters: {
      type: "object",
      properties: {
        service_type: { type: "string" },
        preferred_window: { type: "string" },
        service_address: { type: "string" },
        city: { type: "string" },
      },
      required: ["service_type"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "book_appointment",
    description:
      "Create an appointment only after availability has been checked and the caller clearly agrees to the specific slot.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        callback_number: { type: "string" },
        service_type: { type: "string" },
        service_address: { type: "string" },
        city: { type: "string" },
        slot: { type: "string" },
        notes: { type: "string" },
      },
      required: ["name", "callback_number", "service_type", "slot"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "transfer_to_human",
    description:
      "Transfer the current live call to a human for escalation or at the caller's request.",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Short reason for the transfer." },
      },
      required: ["reason"],
      additionalProperties: false,
    },
  },
];
