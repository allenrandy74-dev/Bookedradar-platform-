function hoursSince(value, nowMs) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) && ms > 0 ? Math.max(0, (nowMs - ms) / 3600000) : 0;
}

const THRESHOLDS_HOURS = Object.freeze({
  phone_lead: 4,
  missed_call: 1,
  web_lead: 1,
  after_hours_lead: 12,
  estimate_sent: 72,
  appointment_cancelled: 4,
  customer_dormant: 168,
  membership_renewal_due: 72,
});

function nextActionFor(type) {
  return ({
    phone_lead: "Review lead and confirm the next customer-facing step.",
    missed_call: "Make sure the missed caller receives a timely response.",
    web_lead: "Respond while the web lead is still fresh.",
    after_hours_lead: "Confirm the after-hours request was handed to the right person.",
    estimate_sent: "Follow up on the open estimate and resolve questions or next steps.",
    appointment_cancelled: "Offer a reschedule and consider backfilling the released capacity.",
    customer_dormant: "Review consent and decide whether reactivation is appropriate.",
    membership_renewal_due: "Review the service agreement renewal and contact the customer through an approved channel.",
  })[type] || "Review this opportunity and choose the appropriate next step.";
}

function sourceLabel(opportunity) {
  return opportunity.source || opportunity.type || "unknown";
}

export async function revenueLeakRadar(store, tenantId, { now = new Date() } = {}) {
  const data = await store.snapshot();
  const nowMs = now.getTime();
  const opportunities = Object.values(data.opportunities || {})
    .filter(item => item.tenantId === tenantId && item.status !== "closed");
  const actions = Object.values(data.actions || {})
    .filter(item => item.tenantId === tenantId);
  const attribution = data.attribution || {};

  const leaks = [];
  for (const opportunity of opportunities) {
    const threshold = THRESHOLDS_HOURS[opportunity.type] ?? 24;
    const ageHours = hoursSince(opportunity.updatedAt || opportunity.createdAt, nowMs);
    const opportunityActions = actions.filter(action => action.opportunityId === opportunity.id);
    const overdueActions = opportunityActions.filter(action =>
      ["pending", "processing"].includes(action.status) &&
      new Date(action.dueAt || 0).getTime() <= nowMs
    );
    const failedActions = opportunityActions.filter(action => action.status === "failed");
    const hasActiveWork = opportunityActions.some(action =>
      ["pending", "processing"].includes(action.status) &&
      new Date(action.dueAt || 0).getTime() > nowMs
    );

    const stale = ageHours >= threshold;
    const operationalFailure = failedActions.length > 0 || overdueActions.length > 0;
    if (!stale && !operationalFailure) continue;

    const value = Number(
      attribution[opportunity.id]?.estimatedOpportunityValue ??
      opportunity.estimatedOpportunityValue ??
      0
    );

    const priority =
      operationalFailure || value >= 3000 || ageHours >= threshold * 3
        ? "high"
        : value >= 750 || ageHours >= threshold * 1.5
          ? "medium"
          : "normal";

    leaks.push({
      opportunityId: opportunity.id,
      type: opportunity.type,
      source: sourceLabel(opportunity),
      serviceType: opportunity.serviceType || "",
      urgency: opportunity.urgency || "",
      ageHours: Math.round(ageHours * 10) / 10,
      staleThresholdHours: threshold,
      estimatedOpportunityValue: value,
      overdueActions: overdueActions.length,
      failedActions: failedActions.length,
      futureActionsScheduled: hasActiveWork,
      priority,
      recommendedNextAction: nextActionFor(opportunity.type),
    });
  }

  const rank = { high: 3, medium: 2, normal: 1 };
  leaks.sort((a, b) =>
    rank[b.priority] - rank[a.priority] ||
    b.estimatedOpportunityValue - a.estimatedOpportunityValue ||
    b.ageHours - a.ageHours
  );

  return {
    generatedAt: now.toISOString(),
    tenantId,
    openOpportunities: opportunities.length,
    leakCount: leaks.length,
    estimatedValueAtRisk: leaks.reduce((sum, item) => sum + item.estimatedOpportunityValue, 0),
    overdueActionCount: leaks.reduce((sum, item) => sum + item.overdueActions, 0),
    failedActionCount: leaks.reduce((sum, item) => sum + item.failedActions, 0),
    leaks,
    disclaimer: "Revenue Leak Radar highlights open or operationally delayed opportunities using configured timing rules and diagnostic opportunity values. It does not claim that every flagged opportunity would otherwise be lost or that estimated value is confirmed revenue.",
  };
}

export async function ownerDailyBrief(store, tenantId, { now = new Date(), callActivity = null } = {}) {
  const data = await store.snapshot();
  const nowMs = now.getTime();
  const sinceMs = nowMs - 24 * 3600000;
  const opportunities = Object.values(data.opportunities || {}).filter(item => item.tenantId === tenantId);
  const recent = opportunities.filter(item => new Date(item.createdAt || 0).getTime() >= sinceMs);
  const recovered = recent.filter(item => item.recovered);
  const attribution = Object.values(data.attribution || {}).filter(item =>
    item.tenantId === tenantId || opportunities.some(opp => opp.id === item.opportunityId)
  );
  const confirmedLast24h = attribution
    .filter(item => new Date(item.confirmedAt || 0).getTime() >= sinceMs)
    .reduce((sum, item) => sum + Number(item.confirmedRevenue || 0), 0);
  const leaks = await revenueLeakRadar(store, tenantId, { now });

  return {
    generatedAt: now.toISOString(),
    windowHours: 24,
    newOpportunities: recent.length,
    recoveredOpportunities: recovered.length,
    confirmedRevenue: confirmedLast24h,
    callsHandled: Number(callActivity?.callsHandled || 0),
    humanTransfers: Number(callActivity?.humanTransfers || 0),
    spamScreened: Number(callActivity?.spamScreened || 0),
    knowledgeGaps: Number(callActivity?.knowledgeGaps || 0),
    openRevenueLeaks: leaks.leakCount,
    estimatedValueAtRisk: leaks.estimatedValueAtRisk,
    topAttentionItems: leaks.leaks.slice(0, 5),
  };
}

export async function opportunityTimeline(store, tenantId, opportunityId) {
  const data = await store.snapshot();
  const opportunity = data.opportunities?.[opportunityId];
  if (!opportunity || opportunity.tenantId !== tenantId) return null;

  const events = (data.events || []).filter(event =>
    event.opportunityId === opportunityId ||
    event.id === opportunity.sourceEventId
  ).map(event => ({
    kind: "event",
    id: event.id,
    type: event.type,
    at: event.occurredAt || null,
    source: event.source || null,
  }));

  const actions = Object.values(data.actions || {})
    .filter(action => action.tenantId === tenantId && action.opportunityId === opportunityId)
    .map(action => ({
      kind: "action",
      id: action.id,
      type: action.template || action.channel,
      channel: action.channel,
      status: action.status,
      at: action.completedAt || action.dueAt || action.createdAt || null,
      blockedReason: action.blockedReason || null,
      cancelledReason: action.cancelledReason || null,
    }));

  const attribution = data.attribution?.[opportunityId] || null;
  const items = [...events, ...actions].sort((a, b) =>
    new Date(a.at || 0).getTime() - new Date(b.at || 0).getTime()
  );

  return {
    tenantId,
    opportunity,
    attribution,
    timeline: items,
  };
}

export async function radarTrust(store, tenant, { callActivity = null } = {}) {
  const data = await store.snapshot();
  const tenantId = tenant.tenantId;
  const actions = Object.values(data.actions || {}).filter(item => item.tenantId === tenantId);
  const blocked = actions.filter(item => item.status === "blocked");
  const cancelled = actions.filter(item => item.status === "cancelled");

  return {
    generatedAt: new Date().toISOString(),
    tenantId,
    controls: {
      bookingMode: tenant?.policies?.bookingMode || "confirm_only",
      schedulingApproved: tenant?.commercial?.schedulingApproved === true,
      schedulingAgreementReferencePresent: Boolean(String(tenant?.commercial?.schedulingAgreementReference || "").trim()),
      quotePrices: tenant?.policies?.quotePrices === true,
      recordCalls: tenant?.policies?.recordCalls === true,
      transcriptRetentionApproved: tenant?.policies?.transcriptRetentionApproved === true,
      callerMemory: tenant?.features?.callerMemory === true,
      spamScreening: tenant?.features?.spamScreening === true,
      twoWaySms: tenant?.features?.twoWaySms === true && tenant?.integrations?.sms?.enabled === true,
      webChat: tenant?.features?.webChat === true && tenant?.integrations?.webChat?.enabled === true,
      liveCalendarConfigured: tenant?.integrations?.calendar?.enabled === true,
    },
    actionAudit: {
      totalActions: actions.length,
      blockedActions: blocked.length,
      cancelledActions: cancelled.length,
      blockedByReason: blocked.reduce((acc, item) => {
        const key = item.blockedReason || "unknown";
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
      cancelledByReason: cancelled.reduce((acc, item) => {
        const key = item.cancelledReason || "unknown";
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
    },
    callActivity: callActivity || {},
    principle: "BookedRadar should act only within approved tenant permissions, preserve evidence of blocked/cancelled automation, and escalate uncertainty instead of inventing business facts.",
  };
}


function maskPhone(phone = "") {
  const digits = String(phone).replace(/\D/g, "");
  return digits.length >= 4 ? `***${digits.slice(-4)}` : "";
}

function maskEmail(email = "") {
  const [local, domain] = String(email).split("@");
  if (!local || !domain) return "";
  return `${local.slice(0, 1)}***@${domain}`;
}

export async function cancellationBackfillCandidates(store, tenantId, cancellationOpportunityId, { now = new Date() } = {}) {
  const data = await store.snapshot();
  const cancelled = data.opportunities?.[cancellationOpportunityId];
  if (!cancelled || cancelled.tenantId !== tenantId || cancelled.type !== "appointment_cancelled") return null;

  const city = String(cancelled.metadata?.city || "").trim().toLowerCase();
  const serviceType = String(cancelled.serviceType || "").trim().toLowerCase();
  const nowMs = now.getTime();

  const candidates = Object.values(data.opportunities || {})
    .filter(item => item.tenantId === tenantId && item.type === "earlier_slot_requested" && item.status !== "closed")
    .filter(item => {
      const expires = Date.parse(item.metadata?.expiresAt || "");
      if (Number.isFinite(expires) && expires < nowMs) return false;
      const candidateCity = String(item.metadata?.city || "").trim().toLowerCase();
      const candidateService = String(item.serviceType || "").trim().toLowerCase();
      if (city && candidateCity && city !== candidateCity) return false;
      if (serviceType && candidateService && serviceType !== candidateService) return false;
      return true;
    })
    .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0))
    .slice(0, 20)
    .map(item => {
      const contact = data.contacts?.[item.contactKey] || {};
      return {
        opportunityId: item.id,
        requestedAt: item.createdAt,
        serviceType: item.serviceType || "",
        city: item.metadata?.city || "",
        preferredWindow: item.metadata?.preferredWindow || "",
        urgency: item.urgency || "",
        contact: {
          name: contact.name || [contact.firstName, contact.lastName].filter(Boolean).join(" "),
          phone: maskPhone(contact.phone),
          email: maskEmail(contact.email),
        },
      };
    });

  return {
    cancellationOpportunityId,
    releasedSlot: cancelled.metadata?.scheduledFor || "",
    city: cancelled.metadata?.city || "",
    serviceType: cancelled.serviceType || "",
    candidateCount: candidates.length,
    candidates,
    action: "Review candidates before contacting anyone. Matching does not itself send a message or change an appointment.",
  };
}

export async function reviewRadar(store, tenantId) {
  const data = await store.snapshot();
  const jobs = Object.values(data.opportunities || {})
    .filter(item => item.tenantId === tenantId && item.type === "job_completed" && item.status !== "closed");

  const eligible = [];
  const needsReview = [];
  for (const job of jobs) {
    const contact = data.contacts?.[job.contactKey] || {};
    const meta = job.metadata || {};
    const summary = {
      opportunityId: job.id,
      jobId: meta.jobId || "",
      serviceType: job.serviceType || "",
      completedAt: meta.completedAt || job.createdAt,
      customerName: contact.name || [contact.firstName, contact.lastName].filter(Boolean).join(" "),
    };
    if (meta.complaintOpen === true) {
      needsReview.push({ ...summary, reason: "open_complaint" });
    } else if (meta.customerSatisfactionKnown === true && meta.customerSatisfied === true) {
      eligible.push(summary);
    } else {
      needsReview.push({ ...summary, reason: "satisfaction_not_confirmed" });
    }
  }

  return {
    tenantId,
    eligibleCount: eligible.length,
    needsReviewCount: needsReview.length,
    eligible,
    needsReview,
    rule: "RadarReview never treats an unknown or unhappy customer as an automatic public-review candidate.",
  };
}

export async function membershipRadar(store, tenantId, { now = new Date() } = {}) {
  const data = await store.snapshot();
  const nowMs = now.getTime();
  const items = Object.values(data.opportunities || {})
    .filter(item => item.tenantId === tenantId && item.type === "membership_renewal_due" && item.status !== "closed")
    .map(item => {
      const contact = data.contacts?.[item.contactKey] || {};
      const renewalMs = Date.parse(item.metadata?.renewalDate || "");
      const daysUntilRenewal = Number.isFinite(renewalMs)
        ? Math.ceil((renewalMs - nowMs) / 86400000)
        : null;
      return {
        opportunityId: item.id,
        membershipId: item.metadata?.membershipId || "",
        membershipName: item.metadata?.membershipName || "",
        renewalDate: item.metadata?.renewalDate || "",
        daysUntilRenewal,
        customerName: contact.name || [contact.firstName, contact.lastName].filter(Boolean).join(" "),
        estimatedOpportunityValue: Number(item.estimatedOpportunityValue || 0),
      };
    })
    .sort((a, b) => {
      if (a.daysUntilRenewal == null) return 1;
      if (b.daysUntilRenewal == null) return -1;
      return a.daysUntilRenewal - b.daysUntilRenewal;
    });

  return {
    tenantId,
    renewalCount: items.length,
    renewals: items,
  };
}
