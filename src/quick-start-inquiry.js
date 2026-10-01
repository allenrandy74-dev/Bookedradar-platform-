import { quickStartInputFromWixSubmission } from "./onboarding/customer-intake.js";

const limits = {
  first_name: 120, business_name: 160, email: 254, contact_preference: 20,
  phone: 40, business_type: 120, service_area: 500, business_hours: 500,
  services: 2000, coverage: 100, urgent_contact: 500, urgent_definition: 2000,
  customer_tracking: 100, booking: 20, anything_else: 2000,
};
const required = ["first_name", "business_name", "email", "business_type", "service_area", "business_hours", "services", "coverage", "urgent_contact"];
const choices = {
  coverage: ["After hours", "When nobody answers", "When our team is busy", "A combination", "I'm not sure — recommend a setup"],
  customer_tracking: ["", "A business software/app", "A spreadsheet", "Paper or notes", "We don't really have a system", "Not sure"],
  booking: ["", "Yes", "No", "Sometimes"],
};

// Validate the complete questionnaire before capture; never silently cut answers.
export function normalizeQuickStartAnswers(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "setup_answers_required" };
  const answers = {};
  for (const [key, max] of Object.entries(limits)) {
    if (input[key] != null && typeof input[key] !== "string") return { ok: false, error: "invalid_setup_answer" };
    answers[key] = String(input[key] || "").trim();
    if (answers[key].length > max) return { ok: false, error: "setup_answer_too_long" };
  }
  answers.contact_preference ||= "email";
  if (!["email", "phone"].includes(answers.contact_preference)) return { ok: false, error: "invalid_contact_preference" };
  if (answers.contact_preference === "email") answers.phone = "";
  if (required.some(key => !answers[key])) return { ok: false, error: "setup_required_answers_missing" };
  for (const [key, options] of Object.entries(choices)) {
    if (!options.includes(answers[key])) return { ok: false, error: "invalid_setup_choice" };
  }
  if (!quickStartInputFromWixSubmission({ submissions: answers }).escalationPhone) return { ok: false, error: "setup_transfer_number_required" };
  return { ok: true, answers };
}

export function quickStartReport(answers) {
  return [
    "Customer setup questionnaire — review and testing required; service is not active.",
    "Caller transfer destination is separate from setup follow-up and is not permission for sales calls.",
    ...Object.entries(answers).filter(([, value]) => value).map(([key, value]) => `${key}: ${value}`),
  ].join("\n");
}
