import crypto from "node:crypto";
import { playbookFor, TERMINAL_EVENTS } from "./catalog.js";
import { actionAllowed } from "./compliance.js";

// The JSON store has no transaction wrapper. Serialize engine ingestion on a
// shared store so receipt validation and consent changes cannot interleave.
// Postgres continues to use its own tenant-scoped database transaction.
const ingestionChains = new WeakMap();

function rawContactKey(event) {
  return (
    event.contactKey ||
    event.contact?.externalId ||
    event.contact?.phone ||
    event.contact?.email ||
    `anonymous:${crypto.randomUUID()}`
  );
}

function tenantContactKey(tenantId, event) {
  const raw = rawContactKey(event);
  return String(raw).startsWith(`${tenantId}:`)
    ? String(raw)
    : `${tenantId}:${raw}`;
}

function contactRecipients(contact = {}) {
  const recipients = [];
  if (typeof contact?.phone === "string") {
    const phone = contact.phone.trim().replace(/[\s().-]/g, "");
    if (/^\+[1-9]\d{7,14}$/.test(phone)) recipients.push(["phone", phone]);
  }
  if (typeof contact?.email === "string") {
    const email = contact.email.trim().toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) recipients.push(["email", email]);
  }
  return recipients;
}

function recipientSuppressionKey(tenantId, [kind, value]) {
  return `${tenantId}:suppressed-recipient:${kind}:${encodeURIComponent(value)}`;
}

export async function recipientSuppressed(store, tenantId, contact) {
  if (typeof tenantId !== "string" || !tenantId ||
      contact?.tenantId && contact.tenantId !== tenantId) {
    throw new Error("Contact suppression tenant mismatch");
  }
  for (const recipient of contactRecipients(contact)) {
    const key = recipientSuppressionKey(tenantId, recipient);
    const tombstone = await store.getContact(key);
    if (tombstone?.tenantId === tenantId && tombstone.contactKey === key &&
        tombstone.kind === "recipient_suppression" &&
        tombstone.recipient?.kind === recipient[0] && tombstone.recipient.value === recipient[1] &&
        (tombstone.suppressed || tombstone.optedOut)) {
      return true;
    }
  }
  return false;
}

export async function contactWithRecipientSuppression(store, tenantId, contact) {
  return await recipientSuppressed(store, tenantId, contact)
    ? { ...contact, suppressed: true, optedOut: true }
    : contact;
}

function nonnegativeMoney(value, field) {
  // Numeric strings remain supported for existing intake clients, but coercible
  // objects, booleans, empty strings and null are not monetary amounts.
  if (!(typeof value === "number" ||
        typeof value === "string" && /^[+\-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+\-]?\d+)?$/i.test(value.trim())) ||
      !Number.isFinite(Number(value)) || Number(value) < 0) {
    throw new Error(`${field} must be a finite non-negative amount`);
  }
  return Number(value);
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

export function validateRecoveryEvent(event, tenant) {
  if (!record(event)) throw new Error("Invalid recovery event: object required");
  if (typeof tenant?.tenantId !== "string" || !tenant.tenantId.trim()) {
    throw new Error("Invalid recovery tenant");
  }
  if (typeof event.type !== "string" || !event.type.trim()) {
    throw new Error("Invalid recovery event type");
  }
  // Unknown/custom event names retain the existing no-playbook behavior.
  for (const field of ["id", "idempotencyKey", "tenantId", "opportunityId", "contactKey", "bookingId"]) {
    if (event[field] !== undefined && !(field === "bookingId" && event[field] === null) &&
        (typeof event[field] !== "string" || !event[field].trim())) {
      throw new Error(`Invalid recovery event ${field}`);
    }
  }
  if (event.tenantId !== undefined && event.tenantId !== tenant.tenantId) {
    throw new Error("Recovery event tenant mismatch");
  }
  if (event.occurredAt !== undefined &&
      (!(typeof event.occurredAt === "string" && event.occurredAt.trim() ||
         typeof event.occurredAt === "number") ||
       !Number.isFinite(new Date(event.occurredAt).getTime()))) {
    throw new Error("Invalid recovery event occurredAt");
  }
  for (const field of ["contact", "metadata"]) {
    if (event[field] !== undefined && !record(event[field])) {
      throw new Error(`Invalid recovery event ${field}`);
    }
  }
  const contact = event.contact || {};
  for (const field of ["contactKey", "externalId", "phone", "email", "tenantId"]) {
    if (contact[field] !== undefined && typeof contact[field] !== "string") {
      throw new Error(`Invalid recovery contact ${field}`);
    }
  }
  if (contact.tenantId !== undefined && contact.tenantId !== tenant.tenantId) {
    throw new Error("Recovery contact tenant mismatch");
  }
  for (const field of ["optedOut", "suppressed", "marketingConsent", "smsMarketingConsent", "transactionalSmsAllowed"]) {
    if (contact[field] !== undefined && typeof contact[field] !== "boolean") {
      throw new Error(`Invalid recovery contact ${field}`);
    }
  }
  const normalized = {
    ...event, tenantId: tenant.tenantId,
    occurredAt: event.occurredAt === undefined ? new Date().toISOString() : event.occurredAt,
  };
  for (const field of ["amount", "estimateAmount", "estimatedOpportunityValue", "estimatedRecoveredValue"]) {
    if (field !== "amount" && event[field] === null) delete normalized[field];
    else if (event[field] !== undefined) normalized[field] = nonnegativeMoney(event[field], field);
  }
  if ((TERMINAL_EVENTS.has(event.type) && event.type !== "contact_opted_out" ||
       ["customer_replied", "revenue_confirmed"].includes(event.type)) && !event.opportunityId) {
    throw new Error("Recovery event opportunityId required");
  }
  if (event.type === "contact_opted_out" &&
      ![event.opportunityId, event.contactKey, contact.contactKey, contact.externalId, contact.phone, contact.email]
        .some(value => typeof value === "string" && value.trim())) {
    throw new Error("Contact identity required for opt-out");
  }
  if (event.type === "revenue_confirmed" && event.amount === undefined) {
    throw new Error("Revenue amount required");
  }
  // Clone accepted inputs before queuing or delegating: later caller mutation
  // must not bypass validation while an earlier ingestion is awaiting storage.
  return structuredClone(normalized);
}

function estimateValue(event, tenant) {
  if (event.estimatedOpportunityValue !== undefined) return event.estimatedOpportunityValue;
  if (event.estimateAmount !== undefined) return event.estimateAmount;
  const byType = tenant?.economics?.averageJobValueByType || {};
  return nonnegativeMoney(
    byType[event.serviceType] ?? tenant?.economics?.defaultAverageJobValue ?? 0,
    "estimatedOpportunityValue"
  );
}

export class RecoveryEngine {
  constructor({ store, tenant }) {
    this.store = store;
    this.tenant = tenant;
  }

  async ingest(event) {
    event = validateRecoveryEvent(event, this.tenant);
    if (typeof this.store.ingest === "function") return this.store.ingest(event, this.tenant);
    const pending = ingestionChains.get(this.store) || Promise.resolve();
    const result = pending.then(async () => {
      if (typeof this.store.transaction !== "function") return this.ingestLocal(event);
      if (event.type === "contact_opted_out") {
        if (!event.id && !event.idempotencyKey) event = { ...event, id: `evt_${crypto.randomUUID()}` };
        // Durable suppression and its identity-bound receipt precede cancellation.
        // If later cleanup fails, delivery stays suppressed and a replay repairs
        // it; ordinary intake still uses a single atomic transaction below.
        const prepared = await this.store.transaction(store =>
          new RecoveryEngine({ store, tenant: this.tenant }).ingestContactOptOut(event, { prepareOnly: true }));
        const completed = await this.store.transaction(store =>
          new RecoveryEngine({ store, tenant: this.tenant }).ingestContactOptOut(event));
        if (!prepared.event.duplicate) delete completed.duplicate;
        completed.event = prepared.event;
        return completed;
      }
      return this.store.transaction(store => new RecoveryEngine({ store, tenant: this.tenant }).ingestLocal(event));
    });
    ingestionChains.set(this.store, result.catch(() => {}));
    return result;
  }

  async ingestLocal(event) {
    event = validateRecoveryEvent(event, this.tenant);
    if (event.type === "contact_opted_out") return this.ingestContactOptOut(event);
    // Validate targets and configuration before a receipt can make an invalid
    // event permanently deduplicated in the non-transactional JSON store.
    if (event.opportunityId && (TERMINAL_EVENTS.has(event.type) ||
        ["customer_replied", "revenue_confirmed"].includes(event.type))) {
      const target = await this.store.getOpportunity(event.opportunityId);
      if (!target) throw new Error("Unknown opportunity");
      if (target.tenantId !== this.tenant.tenantId) {
        throw new Error("Opportunity belongs to a different tenant");
      }
      if (["booking_confirmed", "opportunity_won"].includes(event.type) &&
          event.estimatedRecoveredValue === undefined) {
        nonnegativeMoney(target.estimatedOpportunityValue ?? 0, "estimatedRecoveredValue");
      }
    }
    const playbook = playbookFor(event.type, this.tenant.playbooks || {});
    if (!Array.isArray(playbook)) throw new Error("Invalid recovery playbook");
    for (const step of playbook) {
      const dueAt = new Date(event.occurredAt).getTime() + Number(step.offsetMs || 0);
      if (!Number.isFinite(new Date(dueAt).getTime())) {
        throw new Error("Invalid recovery action dueAt");
      }
    }
    const estimatedOpportunityValue = playbook.length ? estimateValue(event, this.tenant) : 0;
    const contactKey = tenantContactKey(this.tenant.tenantId, event);
    if (contactKey.startsWith(`${this.tenant.tenantId}:suppressed-recipient:`)) {
      throw new Error("Reserved recipient suppression identity");
    }
    const storedEvent = await this.store.addEvent(event);

    if (storedEvent.duplicate) {
      return {
        event: storedEvent,
        duplicate: true,
        ignored: true,
        reason: "duplicate_event",
      };
    }

    // Events that operate on an existing opportunity should not manufacture a
    // new anonymous contact just because the source omitted contact details.
    if (storedEvent.type === "customer_replied" && storedEvent.opportunityId) {
      const opportunity = await this.store.getOpportunity(storedEvent.opportunityId);
      if (!opportunity) throw new Error("Unknown opportunity");
      if (opportunity.tenantId !== this.tenant.tenantId) {
        throw new Error("Opportunity belongs to a different tenant");
      }

      if (opportunity.status === "closed" || TERMINAL_EVENTS.has(opportunity.outcome)) {
        return { event: storedEvent, opportunity, ignored: true, engaged: false,
          reason: "opportunity_closed", cancelledAutomatedActions: 0 };
      }

      if (storedEvent.contact && Object.keys(storedEvent.contact).length) {
        await this.upsertContactPreservingSuppression(opportunity.contactKey, {
          ...storedEvent.contact,
          contactKey: opportunity.contactKey,
          tenantId: this.tenant.tenantId,
        });
      }

      const updated = await this.store.patchOpportunity(storedEvent.opportunityId, {
        status: "engaged",
        engagedAt: storedEvent.occurredAt,
      });

      const cancelledActions = await this.store.cancelPendingActions(
        storedEvent.opportunityId,
        {
          channels: ["sms", "email"],
          reason: "customer_replied",
        }
      );

      return {
        event: storedEvent,
        opportunity: updated,
        engaged: true,
        cancelledAutomatedActions: cancelledActions,
      };
    }

    if (storedEvent.type === "revenue_confirmed" && storedEvent.opportunityId) {
      const opportunity = await this.store.getOpportunity(storedEvent.opportunityId);
      if (!opportunity) throw new Error("Cannot confirm revenue for an unknown opportunity");
      if (opportunity.tenantId !== this.tenant.tenantId) {
        throw new Error("Opportunity belongs to a different tenant");
      }

      const amount = storedEvent.amount;
      const attribution = await this.store.putAttribution(storedEvent.opportunityId, {
        confirmedRevenue: amount,
        confirmedRevenueSource: storedEvent.source || "explicit_confirmation",
        confirmedAt: storedEvent.occurredAt,
      });
      return { event: storedEvent, attribution };
    }

    if (TERMINAL_EVENTS.has(storedEvent.type) && storedEvent.opportunityId) {
      const existing = await this.store.getOpportunity(storedEvent.opportunityId);
      if (!existing) throw new Error("Unknown opportunity");
      if (existing.tenantId !== this.tenant.tenantId) {
        throw new Error("Opportunity belongs to a different tenant");
      }

      // First terminal outcome wins. A correction requires an explicit separate
      // reconciliation workflow; late webhook ordering must not reverse revenue
      // attribution or silently relabel a won opportunity as lost (or vice versa).
      if (existing.status === "closed" || TERMINAL_EVENTS.has(existing.outcome)) {
        return { event: storedEvent, opportunity: existing, ignored: true,
          reason: existing.outcome === storedEvent.type ? "terminal_already_recorded" : "terminal_outcome_conflict",
          recovered: Boolean(existing.recovered) };
      }
      const recovered =
        storedEvent.type === "booking_confirmed" ||
        storedEvent.type === "opportunity_won";

      const opportunity = await this.store.patchOpportunity(storedEvent.opportunityId, {
        status: "closed",
        outcome: storedEvent.type,
        ...(recovered
          ? {
              recovered: true,
              recoveredAt: storedEvent.occurredAt,
              bookingId: storedEvent.bookingId || existing.bookingId || null,
            }
          : {}),
      });

      await this.store.cancelPendingActions(storedEvent.opportunityId, {
        channels: ["sms", "email", "human_task", "human_alert"],
        reason: storedEvent.type,
      });

      if (recovered) {
        await this.store.putAttribution(storedEvent.opportunityId, {
          recovered: true,
          bookingId: storedEvent.bookingId || existing.bookingId || null,
          estimatedRecoveredValue:
            storedEvent.estimatedRecoveredValue ??
            nonnegativeMoney(existing.estimatedOpportunityValue ?? 0, "estimatedRecoveredValue"),
        });
      }

      return { event: storedEvent, opportunity, recovered };
    }

    const contact = await this.upsertContactPreservingSuppression(contactKey, {
      ...(event.contact || {}),
      contactKey,
      tenantId: this.tenant.tenantId,
    });

    if (!playbook.length) {
      return { event: storedEvent, ignored: true, reason: "no_playbook" };
    }

    const opportunity = await this.store.createOpportunity({
      tenantId: this.tenant.tenantId,
      type: storedEvent.type,
      sourceEventId: storedEvent.id,
      contactKey,
      source: storedEvent.source || storedEvent.type,
      serviceType: storedEvent.serviceType || "",
      urgency: storedEvent.urgency || "",
      estimatedOpportunityValue,
      metadata: storedEvent.metadata || {},
    });

    await this.store.putAttribution(opportunity.id, {
      tenantId: this.tenant.tenantId,
      estimatedOpportunityValue: opportunity.estimatedOpportunityValue,
      confirmedRevenue: 0,
      source: opportunity.source,
      recovered: false,
    });

    const base = new Date(storedEvent.occurredAt).getTime();
    const actions = [];

    for (const step of playbook) {
      if (step.feature && this.tenant?.features?.[step.feature] !== true) {
        continue;
      }
      if (
        step.when === "urgent" &&
        !["urgent", "emergency"].includes(storedEvent.urgency)
      ) {
        continue;
      }

      const action = {
        tenantId: this.tenant.tenantId,
        opportunityId: opportunity.id,
        contactKey,
        channel: step.channel,
        template: step.template,
        purpose: step.purpose,
        dueAt: new Date(base + Number(step.offsetMs || 0)).toISOString(),
      };

      const decision = actionAllowed({
        action,
        opportunity,
        contact,
        tenant: this.tenant,
        now: new Date(action.dueAt),
      });

      if (!decision.allowed) {
        actions.push(await this.store.scheduleAction({
          ...action,
          status: "blocked",
          blockedReason: decision.reason,
        }));
      } else {
        actions.push(await this.store.scheduleAction(action));
      }
    }

    return { event: storedEvent, opportunity, actions };
  }

  async upsertContactPreservingSuppression(contactKey, patch) {
    if (contactKey.startsWith(`${this.tenant.tenantId}:suppressed-recipient:`)) {
      throw new Error("Reserved recipient suppression identity");
    }
    const prior = await this.store.getContact(contactKey);
    // Ordinary intake and replies are not a consent-restoration workflow. A new
    // CRM alias must inherit opt-out for its actual delivery recipient, too.
    const protectedContact = await contactWithRecipientSuppression(this.store, this.tenant.tenantId, {
      ...prior,
      ...patch,
      ...(prior?.optedOut ? { optedOut: true } : {}),
      ...(prior?.suppressed ? { suppressed: true } : {}),
    });
    return this.store.upsertContact(contactKey, protectedContact);
  }

  async ingestContactOptOut(event, { prepareOnly = false } = {}) {
    const tenantId = this.tenant.tenantId;
    const prefix = `${tenantId}:`;
    const state = await this.store.snapshot();
    const resolveTarget = input => {
      if (input.tenantId && input.tenantId !== tenantId ||
          input.contact?.tenantId && input.contact.tenantId !== tenantId) {
        throw new Error("Contact opt-out tenant mismatch");
      }
      const opportunity = input.opportunityId ? state.opportunities[input.opportunityId] : null;
      if (input.opportunityId && !opportunity) throw new Error("Unknown opportunity");
      if (opportunity && opportunity.tenantId !== tenantId) {
        throw new Error("Opportunity belongs to a different tenant");
      }
      const raw = input.contactKey || input.contact?.contactKey || input.contact?.externalId ||
        input.contact?.phone || input.contact?.email;
      if (!opportunity && !raw) throw new Error("Contact identity required for opt-out");
      // Explicitly namespaced keys cannot address another tenant. Raw external
      // IDs remain supported through contact.externalId.
      for (const key of [input.contactKey, input.contact?.contactKey]) {
        if (key && String(key).includes(":") && !String(key).startsWith(prefix)) {
          throw new Error("Contact opt-out tenant mismatch");
        }
      }
      const contactKey = opportunity?.contactKey || tenantContactKey(tenantId, {
        contactKey: raw,
      });
      if (typeof contactKey !== "string" || !contactKey.startsWith(prefix)) {
        throw new Error("Contact opt-out tenant mismatch");
      }
      const contact = state.contacts[contactKey];
      if (contact?.tenantId && contact.tenantId !== tenantId) {
        throw new Error("Contact opt-out tenant mismatch");
      }
      for (const key of [input.contactKey, input.contact?.contactKey]) {
        if (key && tenantContactKey(tenantId, { contactKey: key }) !== contactKey) {
          throw new Error("Contact opt-out identity mismatch");
        }
      }
      let recipientOnly = false;
      for (const field of ["externalId", "phone", "email"]) {
        const supplied = input.contact?.[field];
        if (!supplied) continue;
        // Never overwrite an existing contact's identity from an opt-out event.
        // An opportunity can resolve its owner without any contact fields; when
        // fields are provided, require them to agree with the stored identity.
        const normalized = contactRecipients({ [field]: supplied })[0]?.[1];
        const existingNormalized = contactRecipients({ [field]: contact?.[field] })[0]?.[1];
        const mismatch = contact?.[field]
          ? String(existingNormalized || contact[field]) !== String(normalized || supplied)
          : (contact || opportunity) && tenantContactKey(tenantId, { contactKey: supplied }) !== contactKey;
        if (!mismatch) continue;
        // A phone-shaped key can outlive a corrected callback number. A STOP
        // explicitly naming that delivery recipient suppresses the recipient,
        // without overwriting/suppressing the unrelated corrected contact.
        if (!opportunity && normalized && `${prefix}${normalized}` === contactKey) recipientOnly = true;
        else throw new Error("Contact opt-out identity mismatch");
      }
      return { opportunity, contact: recipientOnly ? null : contact, contactKey, recipientOnly };
    };
    const target = resolveTarget(event);
    const eventKey = event.idempotencyKey || event.id;
    const scopedEventKey = eventKey && JSON.stringify([tenantId, eventKey]);
    const previous = eventKey && state.events.find(item => item.id === (state.eventKeys[scopedEventKey] || state.eventKeys[eventKey]) && item.tenantId === tenantId);
    if (event.id && state.events.some(item => item.id === event.id && item !== previous)) {
      throw new Error("Contact opt-out event conflict");
    }
    if (previous) {
      if (previous.type !== "contact_opted_out") throw new Error("Contact opt-out event conflict");
      const priorTarget = resolveTarget(previous);
      if (priorTarget.contactKey !== target.contactKey ||
          (previous.opportunityId || null) !== (event.opportunityId || null)) {
        throw new Error("Contact opt-out event conflict");
      }
    }
    const occurredAt = previous?.occurredAt || event.occurredAt || new Date().toISOString();
    // Match recipient aliases only within this tenant. CRM IDs and corrected
    // caller-number keys may differ from the actual delivery phone/email.
    // A phone-origin STOP must not spread to another phone through a shared
    // household/office email; neither path expands identities transitively.
    const recipients = new Map();
    const addRecipients = contact => {
      for (const recipient of contactRecipients(contact)) {
        recipients.set(recipientSuppressionKey(tenantId, recipient), recipient);
      }
    };
    const contactKeys = new Set(target.recipientOnly ? [] : [target.contactKey]);
    const phoneOrigin = event.source === "twilio_sms" && contactRecipients({ phone: event.contact?.phone }).length > 0;
    if (phoneOrigin) {
      addRecipients({ phone: event.contact.phone });
    } else {
      addRecipients(target.contact || event.contact);
      if (!contactRecipients(target.contact).length) {
        const rawRecipient = target.contactKey.slice(prefix.length);
        addRecipients({ phone: rawRecipient, email: rawRecipient });
      }
    }
    for (const [key, contact] of Object.entries(state.contacts)) {
      if (!key.startsWith(prefix) || contact.tenantId && contact.tenantId !== tenantId || contactKeys.has(key)) continue;
      if (contactRecipients(contact).some(recipient => recipients.has(recipientSuppressionKey(tenantId, recipient)))) {
        contactKeys.add(key);
      }
    }
    // Postgres wraps this whole method in its tenant transaction. JSON has no
    // multi-write transaction, so persist recipient tombstones before alias
    // suppression/cancellation and the receipt last. Replays repair partial work.
    for (const [key, [kind, value]] of recipients) {
      const prior = state.contacts[key];
      if (prior?.tenantId === tenantId && prior.contactKey === key &&
          prior.kind === "recipient_suppression" && prior.recipient?.kind === kind &&
          prior.recipient.value === value && prior.suppressed && prior.optedOut) continue;
      await this.store.upsertContact(key, {
        contactKey: key, tenantId, kind: "recipient_suppression",
        recipient: { kind, value }, optedOut: true, suppressed: true,
      });
    }
    for (const key of contactKeys) {
      const contact = state.contacts[key];
      if (contact?.optedOut && contact?.suppressed) continue;
      await this.store.upsertContact(key, {
        ...(!contact && key === target.contactKey ? event.contact || {} : {}),
        contactKey: key, tenantId, optedOut: true, suppressed: true,
      });
    }
    let opportunity = target.opportunity;
    if (opportunity && opportunity.status !== "closed") {
      opportunity = await this.store.patchOpportunity(opportunity.id, {
        status: "closed",
        outcome: "contact_opted_out",
      });
    }
    if (prepareOnly) {
      const storedEvent = await this.store.addEvent({ ...event, tenantId, contactKey: target.contactKey, occurredAt });
      return { event: storedEvent };
    }
    let cancelledActions = 0;
    const pending = await this.store.snapshot();
    for (const action of Object.values(pending.actions)) {
      if (action.tenantId !== tenantId || !contactKeys.has(action.contactKey) ||
          !["pending", "processing"].includes(action.status)) continue;
      // Preserve dispatching/reconciliation states: a provider may already have
      // accepted those actions. Cancellation must not erase that evidence.
      await this.store.patchAction(action.id, {
        status: "cancelled",
        cancelledReason: "contact_opted_out",
        completedAt: occurredAt,
        claimedBy: null,
        claimedAt: null,
        claimExpiresAt: null,
      });
      cancelledActions += 1;
    }
    const storedEvent = await this.store.addEvent({
      ...event, tenantId, contactKey: target.contactKey, occurredAt,
    });
    return {
      event: storedEvent,
      contactKey: target.contactKey,
      suppressed: true,
      cancelledActions,
      ...(opportunity ? { opportunity, recovered: false } : {}),
      ...(storedEvent.duplicate ? { duplicate: true } : {}),
    };
  }

  async markRecovered(opportunityId, {
    bookingId = null,
    estimatedRecoveredValue = null,
  } = {}) {
    if (estimatedRecoveredValue !== null) {
      estimatedRecoveredValue = nonnegativeMoney(estimatedRecoveredValue, "estimatedRecoveredValue");
    }
    if (typeof this.store.markRecovered === "function") {
      return this.store.markRecovered(opportunityId, { bookingId, estimatedRecoveredValue }, this.tenant);
    }
    if (typeof this.store.transaction === "function") {
      return this.store.transaction(store => new RecoveryEngine({ store, tenant: this.tenant }).markRecoveredLocal(opportunityId, { bookingId, estimatedRecoveredValue }));
    }
    return this.markRecoveredLocal(opportunityId, { bookingId, estimatedRecoveredValue });
  }

  async markRecoveredLocal(opportunityId, { bookingId = null, estimatedRecoveredValue = null } = {}) {
    const existing = await this.store.getOpportunity(opportunityId);
    if (!existing) throw new Error("Unknown opportunity");
    if (existing.tenantId !== this.tenant.tenantId) {
      throw new Error("Opportunity belongs to a different tenant");
    }

    if (existing.status === "closed" || TERMINAL_EVENTS.has(existing.outcome)) {
      throw new Error("terminal_outcome_conflict: use an explicit reconciliation workflow");
    }
    const recoveredValue = estimatedRecoveredValue ??
      nonnegativeMoney(existing.estimatedOpportunityValue ?? 0, "estimatedRecoveredValue");
    const opportunity = await this.store.patchOpportunity(opportunityId, {
      recovered: true,
      bookingId,
      recoveredAt: new Date().toISOString(),
    });

    const attribution = await this.store.putAttribution(opportunityId, {
      recovered: true,
      bookingId,
      estimatedRecoveredValue: recoveredValue,
    });

    return { opportunity, attribution };
  }

  async dueActions(now = new Date()) {
    if (typeof this.store.evaluateDueActions === "function") return this.store.evaluateDueActions(now, this.tenant);
    const due = await this.store.dueActions(now);
    const output = [];

    for (const action of due) {
      if (action.tenantId !== this.tenant.tenantId) continue;

      const opportunity = await this.store.getOpportunity(action.opportunityId);
      const contact = await this.store.getContact(action.contactKey);
      const decision = actionAllowed({
        action,
        opportunity,
        contact,
        tenant: this.tenant,
        now,
      });

      if (!decision.allowed) {
        output.push(await this.store.patchAction(action.id, {
          status: "blocked",
          blockedReason: decision.reason,
        }));
      } else {
        output.push(action);
      }
    }

    return output;
  }
}
