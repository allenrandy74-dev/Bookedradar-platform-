function hourInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);
  return Number(parts.find((p) => p.type === "hour")?.value ?? 0);
}

export function isQuietHour(date, tenant) {
  const quiet = tenant?.policies?.quietHours || { start: 20, end: 8 };
  const hour = hourInZone(date, tenant?.timeZone || "America/Chicago");
  const start = Number(quiet.start ?? 20);
  const end = Number(quiet.end ?? 8);

  if (start === end) return false;
  return start > end ? hour >= start || hour < end : hour >= start && hour < end;
}

export function actionAllowed({
  action,
  opportunity,
  contact = {},
  tenant,
  now = new Date(),
}) {
  if (contact.suppressed || contact.optedOut) {
    return { allowed: false, reason: "contact_suppressed" };
  }

  if (action.channel === "human_task" || action.channel === "human_alert") {
    return { allowed: true };
  }

  if (action.purpose === "marketing" && !contact.marketingConsent) {
    return { allowed: false, reason: "marketing_consent_required" };
  }

  if (action.channel === "sms") {
    const policy = tenant?.policies?.sms || {};
    const transactional =
      action.purpose !== "marketing" &&
      Boolean(contact.transactionalSmsAllowed || policy.allowTransactionalWhenInbound);

    if (action.purpose === "marketing" && !contact.smsMarketingConsent) {
      return { allowed: false, reason: "sms_marketing_consent_required" };
    }
    if (action.purpose !== "marketing" && !transactional) {
      return { allowed: false, reason: "transactional_sms_not_allowed" };
    }
  }

  if (
    ["sms", "phone", "email"].includes(action.channel) &&
    action.purpose === "marketing" &&
    isQuietHour(now, tenant)
  ) {
    return { allowed: false, reason: "quiet_hours" };
  }

  if (opportunity?.status === "closed") {
    return { allowed: false, reason: "opportunity_closed" };
  }

  return { allowed: true };
}
