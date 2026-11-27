import crypto from "node:crypto";

const NOTIFICATION_LEASE_MS = 60_000;
const NOTIFICATION_RETRY_WINDOW_MS = 23 * 60 * 60_000;

function count(value) {
  const n=Number(value || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function buildOpsAlertCandidate({scopeKey,assessment,summary={}}={}) {
  if (!scopeKey || !assessment || ["healthy","no_data"].includes(assessment.status)) return null;
  const signals=(assessment.signals || [])
    .map(signal=>({
      code:String(signal.code || "unknown"),
      count:count(signal.count),
      message:String(signal.message || ""),
    }))
    .filter(signal=>signal.count > 0)
    .sort((a,b)=>a.code.localeCompare(b.code));
  if (!signals.length) return null;

  const critical=assessment.severity === "critical" || assessment.status === "critical";
  const total=signals.reduce((sum,signal)=>sum+signal.count,0);
  // Warning-only conditions must cluster to avoid paging on one-off provider noise.
  if (!critical && total < 3 && !signals.some(signal=>signal.count >= 2)) return null;

  const severity=critical ? "critical" : "warning";
  const fingerprint=crypto
    .createHash("sha256")
    .update(JSON.stringify({scopeKey,severity,codes:signals.map(x=>x.code)}))
    .digest("hex");

  return {
    incidentKey:`ops_${fingerprint.slice(0,32)}`,
    scopeKey,
    severity,
    signals,
    summary:{
      callsStarted:count(summary.callsStarted),
      callsAccepted:count(summary.callsAccepted),
      callsEndedWithoutFirstAudio:count(summary.callsEndedWithoutFirstAudio),
      transferFailures:count(summary.transferFailures),
      leadPersistFailures:count(summary.leadPersistFailures),
      crmSyncFailures:count(summary.crmSyncFailures),
    },
  };
}

function alertMessage(candidate) {
  const summaryLines = candidate.signals.map(signal => `- ${signal.code}: ${signal.count}`);
  return {
    subject: `BookedRadar ${candidate.severity.toUpperCase()} — ${candidate.scopeKey}`,
    text: [
      "BookedRadar operational alert",
      `Scope: ${candidate.scopeKey}`,
      `Severity: ${candidate.severity}`,
      `Incident: ${candidate.incidentKey}`,
      "",
      "Signals:",
      ...summaryLines,
      "",
      `Calls observed: ${candidate.summary.callsStarted}`,
      "No caller PII is included in this alert.",
    ].join("\n"),
  };
}

export class PostgresOpsIncidentStore {
  constructor(pool){this.pool=pool;}

  async observe(candidate,{cooldownMinutes=30,from="",to=""}={}) {
    if (!candidate?.incidentKey) throw new Error("ops_incident_candidate_required");
    const client=await this.pool.connect();
    try {
      await client.query("BEGIN");
      const {rows:[incident]}=await client.query(
        `INSERT INTO bookedradar.ops_incidents
          (incident_key,scope_key,severity,status,first_seen_at,last_seen_at,occurrences,payload)
         VALUES ($1,$2,$3,'active',now(),now(),1,$4::jsonb)
         ON CONFLICT (incident_key) DO UPDATE SET
          scope_key=EXCLUDED.scope_key,
          severity=EXCLUDED.severity,
          status='active',
          last_seen_at=now(),
          resolved_at=NULL,
          occurrences=bookedradar.ops_incidents.occurrences+1,
          payload=EXCLUDED.payload || CASE
            WHEN bookedradar.ops_incidents.payload ? 'notification'
            THEN jsonb_build_object('notification',bookedradar.ops_incidents.payload->'notification')
            ELSE '{}'::jsonb
          END
         RETURNING last_notified_at,payload->'notification' AS pending,clock_timestamp() AS observed_at`,
        [candidate.incidentKey,candidate.scopeKey,candidate.severity,JSON.stringify(candidate)]
      );
      const { pending } = incident;
      const now = incident.observed_at.getTime();
      const destinationKey = crypto.createHash("sha256").update(JSON.stringify([from,to])).digest("hex");
      const retry = pending?.destinationKey === destinationKey &&
        now - Date.parse(pending.createdAt) < NOTIFICATION_RETRY_WINDOW_MS;
      const cooldownMs = Math.max(1,Number(cooldownMinutes)||30) * 60_000;
      const due = !incident.last_notified_at || now - incident.last_notified_at.getTime() > cooldownMs;
      const leaseActive = pending && Date.parse(pending.claimUntil) > now;
      let notification = null;
      // The upsert locks this incident until COMMIT. Expired claims may be
      // reclaimed, but retries reuse the original payload and provider key.
      if (!leaseActive && (retry || due)) {
        notification = {
          ...(retry ? pending : {
            id: crypto.randomUUID(),
            createdAt: incident.observed_at.toISOString(),
            destinationKey,
            message: alertMessage(candidate),
          }),
          claimId: crypto.randomUUID(),
          claimUntil: new Date(now + NOTIFICATION_LEASE_MS).toISOString(),
        };
        await client.query(
          `UPDATE bookedradar.ops_incidents
              SET payload=jsonb_set(payload,'{notification}',$2::jsonb)
            WHERE incident_key=$1`,
          [candidate.incidentKey,JSON.stringify(notification)]
        );
      }
      await client.query("COMMIT");
      return { shouldNotify: Boolean(notification), notification };
    } catch(error) {
      try{await client.query("ROLLBACK");}catch{}
      throw error;
    } finally {client.release();}
  }

  async completeNotification(incidentKey,claimId) {
    const result=await this.pool.query(
      `UPDATE bookedradar.ops_incidents
          SET last_notified_at=clock_timestamp(),payload=payload-'notification'
        WHERE incident_key=$1
          AND payload->'notification'->>'claimId'=$2`,
      [incidentKey,claimId]
    );
    return result.rowCount === 1;
  }

  async releaseNotification(incidentKey,claimId) {
    // Retain the deadline as a short backoff before another retry can claim it.
    const result=await this.pool.query(
      `UPDATE bookedradar.ops_incidents
          SET payload=payload #- '{notification,claimId}'
        WHERE incident_key=$1
          AND payload->'notification'->>'claimId'=$2`,
      [incidentKey,claimId]
    );
    return result.rowCount === 1;
  }

  async resolveScope(scopeKey) {
    const result=await this.pool.query(
      `UPDATE bookedradar.ops_incidents
          SET status='resolved',resolved_at=now()
        WHERE scope_key=$1 AND status='active'
        RETURNING incident_key,severity,occurrences,last_notified_at`,
      [scopeKey]
    );
    return result.rows;
  }

  async active() {
    const result=await this.pool.query(
      `SELECT incident_key,scope_key,severity,status,first_seen_at,last_seen_at,
              last_notified_at,occurrences,payload-'notification' AS payload
         FROM bookedradar.ops_incidents
        WHERE status='active'
        ORDER BY severity,last_seen_at DESC`
    );
    return result.rows;
  }
}

export async function sendOpsAlertEmail({
  apiKey,from,to,notification,fetchImpl=fetch,timeoutMs=8000,
}={}) {
  if (!apiKey || !from || !to) throw new Error("ops_alert_email_not_configured");
  if (!notification?.id || !notification.message) throw new Error("ops_alert_notification_required");
  const { subject, text } = notification.message;
  const response=await fetchImpl("https://api.resend.com/emails",{
    method:"POST",
    signal:AbortSignal.timeout(Math.max(1000,Number(timeoutMs)||8000)),
    headers:{
      Authorization:`Bearer ${apiKey}`,
      "Content-Type":"application/json",
      "Idempotency-Key":`bookedradar/ops/${notification.id}`,
    },
    body:JSON.stringify({from,to:[to],subject,text}),
  });
  const raw=await response.text();
  if(!response.ok) throw new Error(`ops_alert_email_failed_${response.status}`);
  let data={};try{data=raw?JSON.parse(raw):{};}catch{}
  return {accepted:true,id:data?.id || null};
}
