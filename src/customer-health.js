function count(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function assessCustomerHealth({
  voiceAssessment = {},
  readinessBlockers = 0,
  criticalFailedActions = 0,
  totalFailedActions = 0,
  crmSyncFailures = 0,
  valueReviewOverdue = false,
  unresolvedKnowledgeGaps = 0,
  repeatedSupportIssues = 0,
  recentCalls = 0,
  opportunitiesCaptured = 0,
} = {}) {
  const atRisk = [];
  const watch = [];

  const blockers = count(readinessBlockers);
  const criticalActions = count(criticalFailedActions);
  const failedActions = count(totalFailedActions);
  const crmFailures = count(crmSyncFailures);
  const gaps = count(unresolvedKnowledgeGaps);
  const repeats = count(repeatedSupportIssues);
  const calls = count(recentCalls);
  const opportunities = count(opportunitiesCaptured);

  if (blockers > 0) {
    atRisk.push({
      code: "readiness_blocker",
      count: blockers,
      message: "One or more required active capabilities have readiness blockers.",
    });
  }

  if (voiceAssessment?.status === "critical") {
    atRisk.push({
      code: "voice_health_critical",
      count: Math.max(1, voiceAssessment?.signals?.length || 0),
      message: "Voice operations contain a critical reliability signal.",
    });
  } else if (voiceAssessment?.status === "attention") {
    watch.push({
      code: "voice_health_attention",
      count: Math.max(1, voiceAssessment?.signals?.length || 0),
      message: "Voice operations contain a condition that deserves proactive review.",
    });
  }

  if (criticalActions > 0) {
    atRisk.push({
      code: "critical_action_failure",
      count: criticalActions,
      message: "One or more critical human-alert/task recovery actions failed.",
    });
  }

  const nonCriticalFailedActions = Math.max(0, failedActions - criticalActions);
  if (nonCriticalFailedActions > 0) {
    watch.push({
      code: "recovery_action_failure",
      count: nonCriticalFailedActions,
      message: "One or more non-critical recovery actions failed.",
    });
  }

  if (crmFailures > 0) {
    watch.push({
      code: "crm_sync_failure",
      count: crmFailures,
      message: "Durable lead capture remained available, but CRM synchronization failed.",
    });
  }

  if (valueReviewOverdue) {
    watch.push({
      code: "value_review_overdue",
      count: 1,
      message: "The customer value review is due or overdue.",
    });
  }

  if (gaps > 0) {
    watch.push({
      code: "unresolved_knowledge_gaps",
      count: gaps,
      message: "Unresolved caller questions should be reviewed with the customer.",
    });
  }

  if (repeats > 0) {
    watch.push({
      code: "repeated_support_issue",
      count: repeats,
      message: "A materially similar support issue has repeated.",
    });
  }

  if (atRisk.length) {
    return {
      status: "at_risk",
      signals: [...atRisk, ...watch],
      evidenceLevel: calls || opportunities ? "operating" : "limited",
    };
  }

  if (watch.length) {
    return {
      status: "watch",
      signals: watch,
      evidenceLevel: calls || opportunities ? "operating" : "limited",
    };
  }

  if (!calls && !opportunities) {
    return {
      status: "no_data",
      signals: [],
      evidenceLevel: "insufficient",
    };
  }

  return {
    status: "healthy",
    signals: [],
    evidenceLevel: "operating",
  };
}
