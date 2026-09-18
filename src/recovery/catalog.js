export const RECOVERY_TYPES = Object.freeze({
  PHONE_LEAD: "phone_lead",
  MISSED_CALL: "missed_call",
  WEB_LEAD: "web_lead",
  AFTER_HOURS_LEAD: "after_hours_lead",
  ESTIMATE_SENT: "estimate_sent",
  APPOINTMENT_CANCELLED: "appointment_cancelled",
  CUSTOMER_DORMANT: "customer_dormant",
});

export const TERMINAL_EVENTS = new Set([
  "booking_confirmed",
  "opportunity_won",
  "opportunity_lost",
  "contact_opted_out",
]);

const minutes = (n) => n * 60 * 1000;
const hours = (n) => n * 60 * 60 * 1000;
const days = (n) => n * 24 * 60 * 60 * 1000;

export const DEFAULT_PLAYBOOKS = Object.freeze({
  phone_lead: [
    { offsetMs: minutes(10), channel: "human_task", template: "phone_lead_review", purpose: "service" },
    { offsetMs: hours(2), channel: "sms", template: "phone_lead_followup", purpose: "transactional" },
  ],
  missed_call: [
    { offsetMs: 0, channel: "sms", template: "missed_call_ack", purpose: "transactional" },
    { offsetMs: minutes(10), channel: "human_task", template: "missed_call_callback", purpose: "service" },
    { offsetMs: hours(2), channel: "sms", template: "missed_call_followup", purpose: "transactional" },
    { offsetMs: days(1), channel: "human_task", template: "missed_call_next_day", purpose: "service" },
  ],
  web_lead: [
    { offsetMs: 0, channel: "email", template: "web_lead_ack", purpose: "transactional" },
    { offsetMs: minutes(5), channel: "human_task", template: "web_lead_fast_response", purpose: "service" },
    { offsetMs: hours(2), channel: "email", template: "web_lead_followup", purpose: "transactional" },
    { offsetMs: days(1), channel: "human_task", template: "web_lead_next_day", purpose: "service" },
  ],
  after_hours_lead: [
    { offsetMs: 0, channel: "sms", template: "after_hours_ack", purpose: "transactional" },
    { offsetMs: 0, channel: "human_alert", template: "urgent_after_hours_alert", purpose: "service", when: "urgent" },
    { offsetMs: hours(10), channel: "human_task", template: "after_hours_morning_followup", purpose: "service" },
  ],
  estimate_sent: [
    { offsetMs: days(2), channel: "email", template: "estimate_day_2", purpose: "transactional" },
    { offsetMs: days(5), channel: "human_task", template: "estimate_day_5_call", purpose: "service" },
    { offsetMs: days(10), channel: "email", template: "estimate_day_10", purpose: "transactional" },
  ],
  appointment_cancelled: [
    { offsetMs: 0, channel: "sms", template: "cancellation_reschedule", purpose: "transactional" },
    { offsetMs: minutes(5), channel: "human_task", template: "fill_cancelled_slot", purpose: "service" },
    { offsetMs: days(1), channel: "human_task", template: "cancellation_next_day", purpose: "service" },
  ],
  customer_dormant: [
    { offsetMs: 0, channel: "email", template: "reactivation_1", purpose: "marketing" },
    { offsetMs: days(7), channel: "email", template: "reactivation_2", purpose: "marketing" },
    { offsetMs: days(21), channel: "human_task", template: "reactivation_review", purpose: "service" },
  ],
});

export function playbookFor(type, customPlaybooks = {}) {
  return customPlaybooks[type] || DEFAULT_PLAYBOOKS[type] || [];
}
