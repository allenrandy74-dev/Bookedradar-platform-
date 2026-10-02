// Reporting-only classification. Never infer test status from names, numbers,
// source strings, tenant names, or missing markers. No persisted data is changed.
export function syntheticMarker(record) {
  const markers = [record?.synthetic, record?.metadata?.synthetic];
  if (markers.includes(true)) return true;
  if (markers.includes(false)) return false;
  return null;
}

function coverage(records, excludedRecords) {
  return {
    mode: 'explicit_persisted_boolean_markers',
    historicalCompleteness: 'unverified',
    excludedRecords,
    unclassifiedRecords: records.filter(record => syntheticMarker(record) === null).length,
    notice: 'Explicitly marked synthetic records are excluded. Unmarked history has not been verified and may include test activity.',
  };
}

export function customerResultCalls(records) {
  const calls = records.filter(record => syntheticMarker(record) !== true);
  return { calls, coverage: coverage(records, records.length - calls.length) };
}

export function customerResultSnapshot(snapshot, tenantId) {
  const tenantMatches = item => !tenantId || item?.tenantId === tenantId;
  const opportunities = Object.values(snapshot.opportunities || {}).filter(tenantMatches);
  const byId = new Map();
  const bySourceId = new Map();
  for (const item of opportunities) {
    if (!byId.has(item.id)) byId.set(item.id, []);
    byId.get(item.id).push(item);
    if (item.sourceEventId) {
      if (!bySourceId.has(item.sourceEventId)) bySourceId.set(item.sourceEventId, []);
      bySourceId.get(item.sourceEventId).push(item);
    }
  }
  // Identity joins remain tenant-aware even for an all-tenant report.
  const matching = (item, index, key) => (index.get(key) || [])
    .filter(opportunity => !item.tenantId || item.tenantId === opportunity.tenantId);
  const linked = item => matching(item, byId, item.opportunityId);
  const sourceLinked = event => matching(event, bySourceId, event.id);
  const events = (snapshot.events || []).filter(item => tenantMatches(item) ||
    (!item.tenantId && (linked(item).length || sourceLinked(item).length)));
  const attribution = Object.values(snapshot.attribution || {}).filter(item => tenantMatches(item) ||
    (!item.tenantId && linked(item).length));
  const actions = Object.values(snapshot.actions || {}).filter(tenantMatches);
  const syntheticOpportunities = new Set(opportunities.filter(item => syntheticMarker(item) === true));
  for (const event of events.filter(item => syntheticMarker(item) === true)) {
    for (const opportunity of sourceLinked(event)) syntheticOpportunities.add(opportunity);
  }
  // A marked test outcome may already have updated an unmarked opportunity or
  // attribution row. Without a trustworthy split, quarantine that reporting
  // unit; do not relabel or change any persisted record.
  const mixedLineage = new Set();
  for (const item of [...events, ...attribution, ...actions]) {
    if (syntheticMarker(item) !== true) continue;
    for (const opportunity of linked(item)) {
      if (!syntheticOpportunities.has(opportunity)) mixedLineage.add(opportunity);
    }
  }
  const excludedOpportunities = new Set([...syntheticOpportunities, ...mixedLineage]);
  const eligible = item => syntheticMarker(item) !== true &&
    !linked(item).some(opportunity => excludedOpportunities.has(opportunity));
  const keptOpportunities = new Set(opportunities.filter(item => !excludedOpportunities.has(item)));
  const orphanAttribution = attribution.filter(item => !linked(item).length);
  const keptAttribution = new Set(attribution.filter(item => eligible(item) && linked(item).length));
  const seenAttribution = new Set();
  const duplicateAttributionOpportunities = new Set();
  for (const item of keptAttribution) {
    for (const opportunity of linked(item)) {
      if (seenAttribution.has(opportunity)) duplicateAttributionOpportunities.add(opportunity);
      seenAttribution.add(opportunity);
    }
  }
  const keptActions = new Set(actions.filter(eligible));
  const keptEvents = events.filter(item => eligible(item) &&
    !sourceLinked(item).some(opportunity => excludedOpportunities.has(opportunity)));
  const all = [...opportunities, ...attribution, ...actions, ...events];
  const excludedRecords = all.length - keptOpportunities.size - keptAttribution.size - keptActions.size - keptEvents.length;
  return {
    ambiguousAttributionIds: new Set([...duplicateAttributionOpportunities].map(item => item.id)),
    data: {
      ...snapshot,
      opportunities: Object.fromEntries(Object.entries(snapshot.opportunities || {}).filter(([, item]) => keptOpportunities.has(item))),
      // Preserve original keys: legacy attribution may not be keyed by opportunity ID.
      attribution: Object.fromEntries(Object.entries(snapshot.attribution || {}).filter(([, item]) => keptAttribution.has(item))),
      actions: Object.fromEntries(Object.entries(snapshot.actions || {}).filter(([, item]) => keptActions.has(item))),
      events: keptEvents,
    },
    coverage: {
      ...coverage(all, excludedRecords),
      excludedLinkedOpportunities: excludedOpportunities.size,
      excludedSyntheticOpportunities: syntheticOpportunities.size,
      excludedMixedLineageOpportunities: mixedLineage.size,
      excludedOrphanAttribution: orphanAttribution.length,
      duplicateAttributionOpportunities: duplicateAttributionOpportunities.size,
      notice: 'Explicitly marked synthetic records and their linked opportunities are excluded. Totals may omit genuine activity on mixed real/test records. Unlinked attribution is omitted. Unmarked history has not been verified and may include test activity.' + (duplicateAttributionOpportunities.size ? ' Duplicate attribution makes attribution-based monetary totals unavailable until reconciled.' : ''),
    },
  };
}
