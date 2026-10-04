import { stableHash } from "./postgres-migration-audit.js";

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function array(value) { return Array.isArray(value) ? value : []; }

function mapStats(sourceValue, postgresValue) {
  const source = object(sourceValue);
  const postgres = object(postgresValue);
  const sourceKeys = Object.keys(source);
  const postgresKeys = Object.keys(postgres);
  const postgresSet = new Set(postgresKeys);
  const sourceSet = new Set(sourceKeys);
  let sharedMismatchCount = 0;
  for (const key of sourceKeys) {
    if (!postgresSet.has(key)) continue;
    if (stableHash(source[key]) !== stableHash(postgres[key])) sharedMismatchCount++;
  }
  return {
    equal: stableHash(source) === stableHash(postgres),
    sourceCount: sourceKeys.length,
    postgresCount: postgresKeys.length,
    missingInPostgres: sourceKeys.filter(key => !postgresSet.has(key)).length,
    extraInPostgres: postgresKeys.filter(key => !sourceSet.has(key)).length,
    sharedMismatchCount,
    sourceHash: stableHash(source),
    postgresHash: stableHash(postgres),
  };
}

function arrayStats(sourceValue, postgresValue) {
  const source = array(sourceValue);
  const postgres = array(postgresValue);
  const sourceHashes = source.map(stableHash);
  const postgresHashes = postgres.map(stableHash);
  const max = Math.max(source.length, postgres.length);
  let positionalMismatchCount = 0;
  for (let i = 0; i < max; i++) {
    if (sourceHashes[i] !== postgresHashes[i]) positionalMismatchCount++;
  }
  return {
    equal: stableHash(source) === stableHash(postgres),
    sourceCount: source.length,
    postgresCount: postgres.length,
    positionalMismatchCount,
    sameMultiset:
      stableHash([...sourceHashes].sort()) === stableHash([...postgresHashes].sort()),
    sourceHash: stableHash(source),
    postgresHash: stableHash(postgres),
  };
}

function valueStats(source, postgres) {
  return {
    equal: stableHash(source) === stableHash(postgres),
    sourceHash: stableHash(source),
    postgresHash: stableHash(postgres),
  };
}

function storeStats(sourceValue, postgresValue) {
  const source = object(sourceValue);
  const postgres = object(postgresValue);
  const sourceKeys = Object.keys(source);
  const postgresKeys = Object.keys(postgres);
  const sourceSet = new Set(sourceKeys);
  const postgresSet = new Set(postgresKeys);
  return {
    equal: stableHash(sourceValue ?? null) === stableHash(postgresValue ?? null),
    sourceKeyCount: sourceKeys.length,
    postgresKeyCount: postgresKeys.length,
    missingKeyCount: sourceKeys.filter(key => !postgresSet.has(key)).length,
    extraKeyCount: postgresKeys.filter(key => !sourceSet.has(key)).length,
    sourceHash: stableHash(sourceValue ?? null),
    postgresHash: stableHash(postgresValue ?? null),
  };
}

export function diagnoseMigrationDifference(sourceSnapshot = {}, postgresSnapshot = {}) {
  const source = sourceSnapshot || {};
  const postgres = postgresSnapshot || {};
  const components = {
    stateWhole: storeStats(source.state, postgres.state),
    callHistoryWhole: storeStats(source.callHistory, postgres.callHistory),
    recoveryWhole: storeStats(source.recovery, postgres.recovery),
    webChatWhole: storeStats(source.webChat, postgres.webChat),
    transfersWhole: storeStats(source.transfers, postgres.transfers),
    growthMetricsWhole: storeStats(source.growthMetrics, postgres.growthMetrics),
    stateProcessedWebhooks: mapStats(source.state?.processedWebhooks, postgres.state?.processedWebhooks),
    stateAttempts: mapStats(source.state?.attempts, postgres.state?.attempts),
    stateCalls: mapStats(source.state?.calls, postgres.state?.calls),
    callHistoryCalls: mapStats(source.callHistory?.calls, postgres.callHistory?.calls),
    leads: arrayStats(source.leads, postgres.leads),
    recoveryContacts: mapStats(source.recovery?.contacts, postgres.recovery?.contacts),
    recoveryOpportunities: mapStats(source.recovery?.opportunities, postgres.recovery?.opportunities),
    recoveryEvents: arrayStats(source.recovery?.events, postgres.recovery?.events),
    recoveryEventKeys: mapStats(source.recovery?.eventKeys, postgres.recovery?.eventKeys),
    recoveryActions: mapStats(source.recovery?.actions, postgres.recovery?.actions),
    recoveryAttribution: mapStats(source.recovery?.attribution, postgres.recovery?.attribution),
    webChatSessions: mapStats(source.webChat?.sessions, postgres.webChat?.sessions),
    transferProcessedWebhooks: mapStats(source.transfers?.processedWebhooks, postgres.transfers?.processedWebhooks),
    transferCalls: mapStats(source.transfers?.calls, postgres.transfers?.calls),
    growthCounts: mapStats(source.growthMetrics?.counts, postgres.growthMetrics?.counts),
    growthUpdatedAt: valueStats(source.growthMetrics?.updatedAt ?? null, postgres.growthMetrics?.updatedAt ?? null),
    billingTest: valueStats(source.billingTest ?? null, postgres.billingTest ?? null),
    billingLive: valueStats(source.billingLive ?? null, postgres.billingLive ?? null),
  };
  const mismatches = Object.entries(components)
    .filter(([,stats]) => !stats.equal)
    .map(([component,stats]) => ({ component, ...stats }));
  const sourceTopKeys = Object.keys(object(source));
  const postgresTopKeys = Object.keys(object(postgres));
  const sourceTopSet = new Set(sourceTopKeys);
  const postgresTopSet = new Set(postgresTopKeys);
  return {
    equal: stableHash(source) === stableHash(postgres),
    logicalComponentsEqual: mismatches.length === 0,
    sourceHash: stableHash(source),
    postgresHash: stableHash(postgres),
    topLevelShape: {
      sourceKeyCount: sourceTopKeys.length,
      postgresKeyCount: postgresTopKeys.length,
      missingKeyCount: sourceTopKeys.filter(key => !postgresTopSet.has(key)).length,
      extraKeyCount: postgresTopKeys.filter(key => !sourceTopSet.has(key)).length,
    },
    mismatchCount: mismatches.length,
    mismatches,
  };
}
