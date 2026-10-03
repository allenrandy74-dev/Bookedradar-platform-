import { customerResultSnapshot } from "../customer-results-scope.js";

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export async function radarProof(store, tenantId = "", { sinceMs = 0, untilMs = Infinity } = {}) {
  const { data, coverage } = customerResultSnapshot(await store.snapshot(), tenantId);
  const inWindow = (item) => {
    if (!sinceMs && untilMs === Infinity) return true;
    const ts = Date.parse(item?.createdAt || item?.updatedAt || item?.at || "");
    return Number.isFinite(ts) && ts >= Number(sinceMs) && ts < Number(untilMs);
  };
  const opportunities = Object.values(data.opportunities)
    .filter((item) => (!tenantId || item.tenantId === tenantId) && inWindow(item));
  const opportunityIds = new Set(opportunities.map((item) => item.id));
  const allOpportunityIds = new Set(Object.values(data.opportunities).map(item => item.id));
  const attribution = Object.values(data.attribution)
    .filter((item) => (!tenantId || item.tenantId === tenantId || (!item.tenantId && opportunityIds.has(item.opportunityId))))
    .filter((item) => allOpportunityIds.has(item.opportunityId))
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
  const recovered = attribution.filter((item) => item.recovered === true && opportunityIds.has(item.opportunityId));
  const recoveredIds = new Set(recovered.map(item => item.opportunityId));
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
    if (recoveredIds.has(opp.id)) bySource[source].recovered += 1;
  }

  const responseLatencies = data.events
    .filter((event) => (!tenantId || event.tenantId === tenantId) &&
      inWindow({ at: event.occurredAt || event.at || event.createdAt || event.updatedAt }))
    .filter((event) => typeof event.responseLatencySeconds === "number" &&
      Number.isFinite(event.responseLatencySeconds) && event.responseLatencySeconds >= 0)
    .map((event) => event.responseLatencySeconds);

  return {
    dataCoverage: coverage,
    humanTransfersMeaning: "initiated_not_completed",
    generatedAt: new Date().toISOString(),
    windowStart: sinceMs ? new Date(Number(sinceMs)).toISOString() : null,
    windowEnd: Number.isFinite(untilMs) ? new Date(untilMs).toISOString() : null,
    outcomeScope: "Window activity plus later evidence linked to opportunities captured in this window. Recovery counts and rate use unique captured opportunities; orphan attribution is excluded.",
    opportunitiesCaptured: opportunities.length,
    recoveredOpportunities: recoveredIds.size,
    recoveryRate:
      opportunities.length ? recoveredIds.size / opportunities.length : null,
    estimatedOpportunityValue: coverage.duplicateAttributionOpportunities ? null : estimatedOpportunityValue,
    estimatedRecoveredValue: coverage.duplicateAttributionOpportunities ? null : estimatedRecoveredValue,
    confirmedRevenue: coverage.duplicateAttributionOpportunities ? null : confirmedRevenue,
    pendingActions: actions.filter((a) => a.status === "pending").length,
    blockedActions: actions.filter((a) => a.status === "blocked").length,
    medianResponseSeconds: median(responseLatencies),
    bySource,
    disclaimer:
      "Estimated opportunity and recovered values are diagnostic estimates, not confirmed revenue. Confirmed revenue is reported separately only when explicitly supplied by a source system or authorized user.",
  };
}
