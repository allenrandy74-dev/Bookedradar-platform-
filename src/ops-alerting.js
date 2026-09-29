import crypto from "node:crypto";

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

export class PostgresOpsIncidentStore {
  constructor(pool){this.pool=pool;}

  async observe(candidate,{cooldownMinutes=30}={}) {
    if (!candidate?.incidentKey) throw new Error("ops_incident_candidate_required");
    const client=await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
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
          payload=EXCLUDED.payload`,
        [candidate.incidentKey,candidate.scopeKey,candidate.severity,JSON.stringify(candidate)]
      );
      const notify=await client.query(
        `UPDATE bookedradar.ops_incidents
            SET last_notified_at=now()
          WHERE incident_key=$1
            AND (
              last_notified_at IS NULL OR
              last_notified_at < now() - ($2::text || ' minutes')::interval
            )
          RETURNING incident_key,scope_key,severity,occurrences,last_notified_at,payload`,
        [candidate.incidentKey,String(Math.max(1,Number(cooldownMinutes)||30))]
      );
      await client.query("COMMIT");
      return {
        observed:true,
        shouldNotify:Boolean(notify.rows[0]),
        incident:notify.rows[0] || null,
      };
    } catch(error) {
      try{await client.query("ROLLBACK");}catch{}
      throw error;
    } finally {client.release();}
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
              last_notified_at,occurrences,payload
         FROM bookedradar.ops_incidents
        WHERE status='active'
        ORDER BY severity,last_seen_at DESC`
    );
    return result.rows;
  }
}

export async function sendOpsAlertEmail({
  apiKey,from,to,candidate,incidentId,fetchImpl=fetch,timeoutMs=8000,
}={}) {
  if (!apiKey || !from || !to) throw new Error("ops_alert_email_not_configured");
  if (!candidate?.scopeKey) throw new Error("ops_alert_candidate_required");
  const subject=`BookedRadar ${candidate.severity.toUpperCase()} — ${candidate.scopeKey}`;
  const signalLines=candidate.signals.map(x=>`- ${x.code}: ${x.count}`).join("\n");
  const text=[
    `BookedRadar operational alert`,
    `Scope: ${candidate.scopeKey}`,
    `Severity: ${candidate.severity}`,
    `Incident: ${incidentId || candidate.incidentKey}`,
    "",
    "Signals:",
    signalLines,
    "",
    `Calls observed: ${candidate.summary.callsStarted}`,
    "No caller PII is included in this alert.",
  ].join("\n");
  const response=await fetchImpl("https://api.resend.com/emails",{
    method:"POST",
    signal:AbortSignal.timeout(Math.max(1000,Number(timeoutMs)||8000)),
    headers:{
      Authorization:`Bearer ${apiKey}`,
      "Content-Type":"application/json",
      "Idempotency-Key":`bookedradar/ops/${incidentId || candidate.incidentKey}`,
    },
    body:JSON.stringify({from,to:[to],subject,text}),
  });
  const raw=await response.text();
  if(!response.ok) throw new Error(`ops_alert_email_failed_${response.status}`);
  let data={};try{data=raw?JSON.parse(raw):{};}catch{}
  return {accepted:true,id:data?.id || null};
}
