export function assessVoiceHealth(summary = {}) {
  const callsStarted = Number(summary.callsStarted || 0);
  if (!callsStarted) {
    return {
      status: "no_data",
      severity: "none",
      signals: [],
    };
  }

  const signals = [];
  const critical = [];
  const attention = [];

  const noFirstAudio = Number(summary.callsEndedWithoutFirstAudio || 0);
  const greetingFailures = Number(summary.greetingFailures || 0);
  const realtimeErrors = Number(summary.realtimeErrors || 0);
  const sidebandErrors = Number(summary.sidebandErrors || 0);
  const acceptFailures = Number(summary.acceptFailures || 0);
  const leadPersistFailures = Number(summary.leadPersistFailures || 0);
  const crmSyncFailures = Number(summary.crmSyncFailures || 0);
  const unroutedCalls = Number(summary.unroutedCalls || 0);
  const transferFailures = Number(summary.transferFailures || 0);
  const accepted = Number(summary.callsAccepted || 0);
  const transferRequests = Number(summary.transferRequests || 0);
  const transfersInitiated = Number(summary.transfersInitiated || 0);

  if (noFirstAudio > 0) {
    critical.push({
      code: "ended_without_first_audio",
      count: noFirstAudio,
      message: "One or more ended calls never reached first assistant audio.",
    });
  }
  if (greetingFailures > 0) {
    critical.push({
      code: "greeting_failure",
      count: greetingFailures,
      message: "Greeting watchdog failure/fallback occurred.",
    });
  }
  if (acceptFailures > 0) {
    critical.push({
      code: "call_accept_failure",
      count: acceptFailures,
      message: "One or more routed calls failed during acceptance/control setup.",
    });
  }
  if (leadPersistFailures > 0) {
    critical.push({
      code: "lead_persistence_failure",
      count: leadPersistFailures,
      message: "One or more lead captures failed durable persistence.",
    });
  }
  if (transferFailures > 0) {
    critical.push({
      code: "transfer_failure",
      count: transferFailures,
      message: "One or more requested human transfers failed to initiate.",
    });
  }
  if (realtimeErrors > 0) {
    attention.push({
      code: "realtime_error",
      count: realtimeErrors,
      message: "OpenAI Realtime emitted one or more errors.",
    });
  }
  if (sidebandErrors > 0) {
    attention.push({
      code: "sideband_error",
      count: sidebandErrors,
      message: "One or more Realtime sideband WebSocket errors occurred.",
    });
  }
  if (crmSyncFailures > 0) {
    attention.push({
      code: "crm_sync_failure",
      count: crmSyncFailures,
      message: "Lead persistence succeeded but one or more CRM sync attempts failed.",
    });
  }
  if (unroutedCalls > 0) {
    attention.push({
      code: "unrouted_call",
      count: unroutedCalls,
      message: "One or more inbound calls arrived on an unrecognized route.",
    });
  }
  if (accepted < callsStarted) {
    attention.push({
      code: "call_accept_gap",
      count: callsStarted - accepted,
      message: "Some tracked inbound calls were not marked accepted.",
    });
  }
  if (transferRequests > transfersInitiated) {
    attention.push({
      code: "transfer_not_initiated",
      count: transferRequests - transfersInitiated,
      message: "One or more human-transfer requests did not reach the initiated state.",
    });
  }

  signals.push(...critical, ...attention);
  if (critical.length) {
    return { status: "critical", severity: "critical", signals };
  }
  if (attention.length) {
    return { status: "attention", severity: "warning", signals };
  }
  return { status: "healthy", severity: "none", signals: [] };
}
