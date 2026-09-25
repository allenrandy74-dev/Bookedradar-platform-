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
    case "membership-renewal":
      return {
        ...common,
        type: "membership_renewal_due",
        metadata: {
          ...common.metadata,
          membershipId: clean(body.membershipId, 240),
          renewalDate: clean(body.renewalDate, 80),
          membershipName: clean(body.membershipName, 180),
        },
        idempotencyKey:
          body.idempotencyKey ||
          stableKey("membership", [body.membershipId, contact.externalId, body.renewalDate, occurredAt]),
      };
    case "appointment-reminder":
      return {
        ...common,
        type: "appointment_reminder_due",
        metadata: {
          ...common.metadata,
          appointmentId: clean(body.appointmentId, 240),
          scheduledFor: clean(body.scheduledFor, 80),
          serviceAddress: clean(body.serviceAddress, 240),
          city: clean(body.city, 120),
        },
        idempotencyKey:
          body.idempotencyKey ||
          stableKey("reminder", [body.appointmentId, body.scheduledFor, occurredAt]),
      };
    case "job-completed":
      return {
        ...common,
        type: "job_completed",
        metadata: {
          ...common.metadata,
          jobId: clean(body.jobId, 240),
          completedAt: clean(body.completedAt, 80),
          customerSatisfactionKnown: Boolean(body.customerSatisfactionKnown),
          customerSatisfied: body.customerSatisfied === true,
          complaintOpen: body.complaintOpen === true,
        },
        idempotencyKey:
          body.idempotencyKey ||
          stableKey("completed", [body.jobId, contact.externalId, occurredAt]),
      };
    case "earlier-slot":
      return {
        ...common,
        type: "earlier_slot_requested",
        metadata: {
          ...common.metadata,
          preferredWindow: clean(body.preferredWindow, 180),
          city: clean(body.city, 120),
          expiresAt: clean(body.expiresAt, 80),
        },
        idempotencyKey:
          body.idempotencyKey ||
          stableKey("earlier-slot", [body.externalId, contact.externalId, contact.phone, body.preferredWindow, occurredAt]),
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

export function isSmsControlText(text = "") {
  return new Set([
    "START",
    "UNSTOP",
    "HELP",
    "INFO",
  ]).has(String(text).trim().toUpperCase());
}
