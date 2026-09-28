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
  if (realtimeErrors > 0) {
    attention.push({
      code: "realtime_error",
      count: realtimeErrors,
      message: "OpenAI Realtime emitted one or more errors.",
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
