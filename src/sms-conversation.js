function clean(value, max = 2000) {
  return String(value ?? "").trim().slice(0, max);
}

export function smsConversationEnabled(tenant = {}) {
  return tenant?.features?.twoWaySms === true &&
    tenant?.integrations?.sms?.enabled === true;
}

export function smsReplyInstructions({ tenant = {}, opportunity = {} } = {}) {
  const services = Array.isArray(tenant.services) ? tenant.services.filter(Boolean).join(", ") : "";
  const bookingMode = tenant?.policies?.bookingMode || "confirm_only";
  return [
    `You are BookedRadar's SMS assistant for ${clean(tenant.businessName,120) || "the business"}.`,
    "Write one concise, natural SMS reply, normally under 320 characters.",
    "Use only the business and opportunity facts supplied. Never invent pricing, availability, warranties, promotions, arrival times, policies, or diagnoses.",
    bookingMode === "live_booking"
      ? "Do not say an appointment is confirmed unless the supplied opportunity context explicitly says it is confirmed."
      : "Live booking is not enabled. You may collect a preferred day or time, but say the team will confirm it.",
    tenant?.policies?.quotePrices
      ? "Only repeat pricing that is explicitly present in the supplied context."
      : "Do not quote or estimate prices; say the team can help with pricing.",
    services ? `Approved service categories: ${services}.` : "",
    clean(tenant?.escalation?.safetyRule,500)
      ? `Safety rule: ${clean(tenant.escalation.safetyRule,500)}`
      : "For immediate danger, advise the person to move to safety and contact emergency services or the appropriate utility.",
    "If the person asks for a human, has a complaint, payment dispute, unusual request, or asks something not grounded in the supplied facts, say you will pass it to the team rather than guessing.",
    "Do not request Social Security numbers, passwords, or full payment-card numbers.",
    "Match English or Spanish when clear from the customer's message.",
  ].filter(Boolean).join("\n");
}

export async function generateSmsReply({
  client,
  model = "gpt-5.6-luna",
  tenant,
  opportunity,
  contact,
  customerText,
} = {}) {
  if (!client?.responses?.create) throw new Error("sms_ai_client_unavailable");
  const input = [
    `Customer name: ${clean(contact?.name,120) || "not known"}`,
    `Service type: ${clean(opportunity?.serviceType,180) || "not known"}`,
    `Urgency: ${clean(opportunity?.urgency,120) || "not known"}`,
    `Preferred timing: ${clean(opportunity?.metadata?.preferredWindow,180) || "not known"}`,
    `Service city: ${clean(opportunity?.metadata?.city,120) || "not known"}`,
    `Customer message: ${clean(customerText,1600)}`,
  ].join("\n");

  const response = await client.responses.create({
    model,
    reasoning: { effort: "none" },
    instructions: smsReplyInstructions({ tenant, opportunity }),
    input,
    max_output_tokens: 180,
  });

  const text = clean(response?.output_text, 600);
  if (!text) throw new Error("sms_ai_empty_reply");
  return text;
}
