const required = [
  "tenantId",
  "businessName",
  "timeZone",
  "trade",
  "serviceArea",
];

export function validateTenant(tenant) {
  const errors = [];
  for (const field of required) {
    if (!tenant?.[field]) errors.push(`Missing required tenant field: ${field}`);
  }

  if (!tenant?.escalation?.humanPhone) {
    errors.push("Missing escalation.humanPhone");
  }

  if (!tenant?.policies?.bookingMode) {
    errors.push("Missing policies.bookingMode");
  }

  if (!["confirm_only", "live_booking"].includes(tenant?.policies?.bookingMode)) {
    errors.push("policies.bookingMode must be confirm_only or live_booking");
  }

  return { valid: errors.length === 0, errors };
}
