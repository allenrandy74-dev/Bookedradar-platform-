export function normalizeProofPilotInquiry(input = {}) {
  const clean = (value, max) => String(value || "").trim().slice(0, max);
  const name = clean(input.name, 120);
  const business = clean(input.business, 160);
  const trade = clean(input.trade, 120);
  const email = clean(input.email, 254).toLowerCase();
  const phone = clean(input.phone, 40);
  const currentWorkflow = clean(input.currentWorkflow, 1200);
  const goal = clean(input.goal, 1200);
  const website = clean(input.website, 300);
  const honeypot = clean(input.company_url, 200);
  if (honeypot) return { ok: false, error: "invalid_submission" };
  if (!name || !business || !trade) return { ok: false, error: "name_business_trade_required" };
  if (!email && !phone) return { ok: false, error: "email_or_phone_required" };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "invalid_email" };
  if (phone && !/^[+()\d\s.-]{7,40}$/.test(phone)) return { ok: false, error: "invalid_phone" };
  return { ok: true, inquiry: { name, business, trade, email, phone, currentWorkflow, goal, website } };
}

export function proofPilotLead(inquiry) {
  const contact = [inquiry.email ? `Email: ${inquiry.email}` : "", inquiry.phone ? `Phone: ${inquiry.phone}` : ""].filter(Boolean).join(" | ");
  return {
    name: inquiry.name,
    email: inquiry.email,
    callback_number: inquiry.phone,
    service_type: `BookedRadar Proof Pilot inquiry — ${inquiry.trade}`,
    urgency: "sales follow-up",
    preferred_window: "",
    notes: [
      `Business: ${inquiry.business}`,
      inquiry.website ? `Website: ${inquiry.website}` : "",
      contact,
      inquiry.currentWorkflow ? `Current after-hours/overflow workflow: ${inquiry.currentWorkflow}` : "",
      inquiry.goal ? `What they want to improve: ${inquiry.goal}` : "",
      "Source: bookedradar.com/try",
    ].filter(Boolean).join("\n"),
  };
}
