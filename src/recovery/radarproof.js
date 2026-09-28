function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export async function radarProof(store, tenantId = "", { sinceMs = 0 } = {}) {
  const data = await store.snapshot();
  const inWindow = (item) => {
    if (!sinceMs) return true;
    const ts = Date.parse(item?.createdAt || item?.updatedAt || item?.at || "");
    return Number.isFinite(ts) && ts >= Number(sinceMs);
  };
  const opportunities = Object.values(data.opportunities)
    .filter((item) => (!tenantId || item.tenantId === tenantId) && inWindow(item));
  const opportunityIds = new Set(opportunities.map((item) => item.id));
  const attribution = Object.values(data.attribution)
    .filter((item) => (!tenantId || item.tenantId === tenantId || opportunityIds.has(item.opportunityId)))
    .filter((item) => opportunityIds.has(item.opportunityId) || inWindow(item));
  const actions = Object.values(data.actions)
    .filter((item) => (!tenantId || item.tenantId === tenantId) && inWindow(item));

  const confirmedRevenue = attribution.reduce(
    (sum, item) => sum + Number(item.confirmedRevenue || 0),
    0
  );
  const estimatedOpportunityValue = attribution.reduce(
    (sum, item) => sum + Number(item.estimatedOpportunityValue || 0),
    0
  );
  const recovered = attribution.filter((item) => item.recovered);
  const estimatedRecoveredValue = recovered.reduce(
    (sum, item) =>
      sum +
      Number(
        item.estimatedRecoveredValue ??
        item.estimatedOpportunityValue ??
        0
      ),
    0
  );

  const bySource = {};
  for (const opp of opportunities) {
    const source = opp.source || "unknown";
    bySource[source] ??= { opportunities: 0, recovered: 0, estimatedValue: 0 };
    bySource[source].opportunities += 1;
    bySource[source].estimatedValue += Number(opp.estimatedOpportunityValue || 0);
    if (opp.recovered) bySource[source].recovered += 1;
  }

  const responseLatencies = data.events
    .filter((event) => Number.isFinite(Number(event.responseLatencySeconds)))
    .map((event) => Number(event.responseLatencySeconds));

  return {
    generatedAt: new Date().toISOString(),
    windowStart: sinceMs ? new Date(Number(sinceMs)).toISOString() : null,
    opportunitiesCaptured: opportunities.length,
    recoveredOpportunities: recovered.length,
    recoveryRate:
      opportunities.length ? recovered.length / opportunities.length : null,
    estimatedOpportunityValue,
    estimatedRecoveredValue,
    confirmedRevenue,
    pendingActions: actions.filter((a) => a.status === "pending").length,
    blockedActions: actions.filter((a) => a.status === "blocked").length,
    medianResponseSeconds: median(responseLatencies),
    bySource,
    disclaimer:
      "Estimated opportunity and recovered values are diagnostic estimates, not confirmed revenue. Confirmed revenue is reported separately only when explicitly supplied by a source system or authorized user.",
  };
}
