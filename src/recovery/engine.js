import crypto from "node:crypto";
import { playbookFor, TERMINAL_EVENTS } from "./catalog.js";
import { actionAllowed } from "./compliance.js";

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

function estimateValue(event, tenant) {
  if (Number.isFinite(Number(event.estimatedOpportunityValue))) {
    return Number(event.estimatedOpportunityValue);
  }
  if (Number.isFinite(Number(event.estimateAmount))) {
    return Number(event.estimateAmount);
  }
  const byType = tenant?.economics?.averageJobValueByType || {};
  return Number(
    byType[event.serviceType] ||
    tenant?.economics?.defaultAverageJobValue ||
    0
  );
}

export class RecoveryEngine {
  constructor({ store, tenant }) {
    this.store = store;
    this.tenant = tenant;
  }

  async ingest(event) {
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

      if (storedEvent.contact && Object.keys(storedEvent.contact).length) {
        await this.store.upsertContact(opportunity.contactKey, {
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

      const amount = Number(storedEvent.amount || 0);
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
            Number(storedEvent.estimatedRecoveredValue) ||
            Number(existing.estimatedOpportunityValue || 0),
        });
      }

      return { event: storedEvent, opportunity, recovered };
    }

    const contactKey = tenantContactKey(this.tenant.tenantId, event);
    const contact = await this.store.upsertContact(contactKey, {
      ...(event.contact || {}),
      contactKey,
      tenantId: this.tenant.tenantId,
    });

    if (storedEvent.type === "contact_opted_out") {
      await this.store.upsertContact(contactKey, {
        optedOut: true,
        suppressed: true,
      });
      return { event: storedEvent, contactKey, suppressed: true };
    }

    const playbook = playbookFor(storedEvent.type, this.tenant.playbooks || {});
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
      estimatedOpportunityValue: estimateValue(storedEvent, this.tenant),
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

  async markRecovered(opportunityId, {
    bookingId = null,
    estimatedRecoveredValue = null,
  } = {}) {
    const existing = await this.store.getOpportunity(opportunityId);
    if (!existing) throw new Error("Unknown opportunity");
    if (existing.tenantId !== this.tenant.tenantId) {
      throw new Error("Opportunity belongs to a different tenant");
    }

    const opportunity = await this.store.patchOpportunity(opportunityId, {
      recovered: true,
      bookingId,
      recoveredAt: new Date().toISOString(),
    });

    const attribution = await this.store.putAttribution(opportunityId, {
      recovered: true,
      bookingId,
      estimatedRecoveredValue:
        estimatedRecoveredValue == null
          ? opportunity.estimatedOpportunityValue
          : Number(estimatedRecoveredValue),
    });

    return { opportunity, attribution };
  }

  async dueActions(now = new Date()) {
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
