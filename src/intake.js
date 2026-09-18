import crypto from "node:crypto";

function clean(value, max = 1000) {
  if (value == null) return "";
  return String(value).trim().slice(0, max);
}

function stableKey(prefix, values) {
  const hash = crypto
    .createHash("sha256")
    .update(values.map((value) => String(value ?? "")).join("|"))
    .digest("hex")
    .slice(0, 24);
  return `${prefix}:${hash}`;
}

export function normalizeIntake(kind, body = {}) {
  const occurredAt = body.occurredAt || new Date().toISOString();
  const contact = {
    name: clean(body.name, 160),
    firstName: clean(body.firstName, 80),
    lastName: clean(body.lastName, 80),
    phone: clean(body.phone, 40),
    email: clean(body.email, 240),
    externalId: clean(body.contactId || body.externalContactId, 240),
    transactionalSmsAllowed: Boolean(body.transactionalSmsAllowed),
    marketingConsent: Boolean(body.marketingConsent),
    smsMarketingConsent: Boolean(body.smsMarketingConsent),
  };

  const common = {
    occurredAt,
    contact,
    serviceType: clean(body.serviceType, 180),
    urgency: clean(body.urgency, 80),
    source: clean(body.source || `api_${kind}`, 180),
    metadata: {
      ...(body.metadata && typeof body.metadata === "object" ? body.metadata : {}),
      externalId: clean(body.externalId, 240),
    },
  };

  switch (kind) {
    case "missed-call":
      return {
        ...common,
        type: "missed_call",
        idempotencyKey:
          body.idempotencyKey ||
          stableKey("missed", [body.externalId, contact.phone, occurredAt]),
      };
    case "web-lead":
      return {
        ...common,
        type: body.afterHours ? "after_hours_lead" : "web_lead",
        estimatedOpportunityValue: body.estimatedOpportunityValue,
        idempotencyKey:
          body.idempotencyKey ||
          stableKey("web", [body.externalId, contact.email, contact.phone, occurredAt]),
      };
    case "estimate":
      return {
        ...common,
        type: "estimate_sent",
        estimateAmount: Number(body.estimateAmount || 0),
        idempotencyKey:
          body.idempotencyKey ||
          stableKey("estimate", [body.externalId, contact.externalId, body.estimateAmount, occurredAt]),
      };
    case "cancellation":
      return {
        ...common,
        type: "appointment_cancelled",
        metadata: {
          ...common.metadata,
          appointmentId: clean(body.appointmentId, 240),
          scheduledFor: clean(body.scheduledFor, 80),
        },
        idempotencyKey:
          body.idempotencyKey || stableKey("cancel", [body.appointmentId, occurredAt]),
      };
    case "dormant":
      return {
        ...common,
        type: "customer_dormant",
        idempotencyKey:
          body.idempotencyKey ||
          stableKey("dormant", [contact.externalId, contact.email, contact.phone, occurredAt]),
      };
    default:
      throw new Error(`Unknown intake kind: ${kind}`);
  }
}

export function isOptOutText(text = "") {
  return new Set([
    "STOP",
    "STOPALL",
    "UNSUBSCRIBE",
    "CANCEL",
    "END",
    "QUIT",
  ]).has(String(text).trim().toUpperCase());
}
