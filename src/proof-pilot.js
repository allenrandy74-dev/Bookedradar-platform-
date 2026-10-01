import crypto from "node:crypto";
import { normalizeQuickStartAnswers, quickStartReport } from "./quick-start-inquiry.js";

export function normalizeProofPilotInquiry(input = {}) {
  let setupAnswers;
  if (String(input.inquiryType || "").trim() === "setup") {
    const setup = normalizeQuickStartAnswers(input.setupAnswers);
    if (!setup.ok) return setup;
    setupAnswers = setup.answers;
    input = { ...input, inquiryType: "setup", auditReport: "", name: setupAnswers.first_name, business: setupAnswers.business_name,
      email: setupAnswers.email, phone: setupAnswers.phone, contactPreference: setupAnswers.contact_preference,
      trade: setupAnswers.business_type, serviceArea: "", businessHours: "", services: "",
      currentWorkflow: "", goal: "", website: "" };
  }
  const clean = (value, max) => String(value || "").trim().slice(0, max);
  const name = clean(input.name, 120);
  const business = clean(input.business, 160);
  const trade = clean(input.trade, 120) || "Not specified";
  const email = clean(input.email, 254).toLowerCase();
  const phone = clean(input.phone, 40);
  const currentWorkflow = clean(input.currentWorkflow, 1200);
  const goal = clean(input.goal, 1200);
  const website = clean(input.website, 300);
  const serviceArea = clean(input.serviceArea, 500);
  const businessHours = clean(input.businessHours, 500);
  const services = clean(input.services, 1200);
  const inquiryType = clean(input.inquiryType, 20) || "pilot";
  const auditReport = clean(input.auditReport, 5000);
  const honeypot = clean(input.company_url, 200);
  const contactPreference = clean(input.contactPreference, 20) || (email ? "email" : "phone");
  if (honeypot) return { ok: false, error: "invalid_submission" };
  if (!["pilot", "audit", "setup"].includes(inquiryType)) return { ok: false, error: "invalid_inquiry_type" };
  if (inquiryType === "audit" && !auditReport) return { ok: false, error: "audit_report_required" };
  if (!name || !business) return { ok: false, error: "name_business_required" };
  if (!["email", "phone"].includes(contactPreference)) return { ok: false, error: "invalid_contact_preference" };
  if (!email && !phone) return { ok: false, error: "email_or_phone_required" };
  if (contactPreference === "email" && !email) return { ok: false, error: "email_required_for_email_followup" };
  if (contactPreference === "phone" && !phone) return { ok: false, error: "phone_required_for_phone_followup" };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "invalid_email" };
  if (phone && !/^[+()\d\s.-]{7,40}$/.test(phone)) return { ok: false, error: "invalid_phone" };
  return { ok: true, inquiry: { name, business, trade, email, phone, contactPreference, currentWorkflow, goal, website, serviceArea, businessHours, services, inquiryType, auditReport, ...(setupAnswers ? { setupAnswers } : {}) } };
}

export function proofPilotLead(inquiry) {
  const emailOnly = (inquiry.contactPreference || (inquiry.email ? "email" : "phone")) === "email";
  const contact = [inquiry.email ? `Email: ${inquiry.email}` : "", inquiry.phone ? `Phone: ${inquiry.phone}` : ""].filter(Boolean).join(" | ");
  return {
    name: inquiry.name,
    email: inquiry.email,
    // An email-only request must not become a generic callback task.
    callback_number: emailOnly ? "" : inquiry.phone,
    service_type: `BookedRadar ${inquiry.inquiryType === "setup" ? "Customer setup review" : inquiry.inquiryType === "audit" ? "Revenue Leak Audit review" : "Proof Pilot inquiry"} — ${inquiry.trade}`,
    urgency: "sales follow-up",
    preferred_window: "",
    notes: [
      `Business: ${inquiry.business}`,
      emailOnly ? "Contact preference: EMAIL ONLY — do not make setup or sales calls." : "Contact preference: PHONE — customer requested a call.",
      inquiry.website ? `Website: ${inquiry.website}` : "",
      inquiry.serviceArea ? `Service area: ${inquiry.serviceArea}` : "",
      inquiry.businessHours ? `Business hours: ${inquiry.businessHours}` : "",
      inquiry.services ? `Main services: ${inquiry.services}` : "",
      contact,
      inquiry.currentWorkflow ? `Current after-hours/overflow workflow: ${inquiry.currentWorkflow}` : "",
      inquiry.goal ? `What they want to improve: ${inquiry.goal}` : "",
      inquiry.inquiryType === "setup" ? quickStartReport(inquiry.setupAnswers) : "",
      inquiry.inquiryType === "audit" ? `Self-reported audit results — illustrative scenario, not a revenue guarantee:\n${inquiry.auditReport}` : "",
      inquiry.inquiryType === "setup" ? "Source: bookedradar.com/setup" : inquiry.inquiryType === "audit" ? "Source: bookedradar.com/audit.html" : "Source: bookedradar.com/try",
    ].filter(Boolean).join("\n"),
  };
}


export function proofPilotInquiryKey(inquiry = {}) {
  const identity = [
    String(inquiry.business || "").trim().toLowerCase(),
    String(inquiry.email || "").trim().toLowerCase(),
    String(inquiry.phone || "").replace(/\D/g, ""),
  ].join("|");
  if (inquiry.inquiryType === "setup") return "customer-setup:" + crypto.createHash("sha256").update(identity + "|" + JSON.stringify(inquiry.setupAnswers)).digest("hex").slice(0, 32);
  const prefix = inquiry.inquiryType === "audit" ? "audit-review:" : "proof-pilot:";
  return prefix + crypto.createHash("sha256").update(identity).digest("hex").slice(0, 32);
}

export function proofPilotTaskLead(inquiry) {
  const lead = proofPilotLead(inquiry);
  return {
    ...lead,
    name: "",
    service_type: inquiry.inquiryType === "setup" ? "Customer setup review" : inquiry.inquiryType === "audit" ? "Revenue Leak Audit" : "Proof Pilot",
    urgency: "",
    notes: [
      inquiry.contactPreference === "phone" ? "PHONE — customer requested a call." : "EMAIL ONLY — do not make setup or sales calls.",
      `Business: ${inquiry.business}`,
      "Full request and business answers are saved in this contact's notes.",
    ].join("\n"),
  };
}
