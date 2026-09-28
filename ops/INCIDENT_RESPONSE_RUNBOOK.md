# BookedRadar Incident Response Runbook

## Purpose
BookedRadar supports revenue-generating customer communications. During an incident, the priority order is:

1. Protect callers and customer data.
2. Preserve a working human escape path.
3. Restore service quickly using the safest proven mode.
4. Communicate clearly with affected customers.
5. Preserve evidence and learn from the incident.

Do not experiment on live customer traffic during an incident.

## Severity levels

### SEV-1 — Critical
Use when any of these are true:
- Multiple customers cannot receive/handle inbound calls.
- Calls are being routed to the wrong tenant/business.
- Material customer data is exposed or cross-tenant data isolation is suspected.
- Human-transfer fallback is broadly unavailable with no safe alternative.
- BookedRadar is materially causing callers to be stranded or misrouted.

Targets:
- Acknowledge immediately when detected.
- Stop unsafe automation/feature paths.
- Establish incident owner and communication owner.
- Send an affected-customer update as soon as scope is known.
- Prefer degraded safe service over a feature-complete broken service.

### SEV-2 — High
Use when:
- One customer has a material service interruption.
- A major function such as transfer, CRM write, or lead persistence is failing for a subset of traffic.
- Elevated greeting latency/silence/dropped-call behavior is confirmed.
- A provider dependency is degraded but the core call path still works.

### SEV-3 — Normal
Use for:
- Non-urgent defects with a workaround.
- Reporting/dashboard lag.
- Optional feature failure while the core call path remains healthy.
- Individual configuration issues that do not create unsafe routing.

## Incident roles
For every SEV-1/SEV-2 incident assign:
- **Incident Commander:** owns decisions and coordinates response.
- **Technical Lead:** investigates and restores service.
- **Customer Communications Owner:** communicates impact, status, workaround, and resolution.
- **Scribe:** records timeline, actions, provider events, deployment IDs, and evidence.

One person may hold multiple roles in a small company, but the responsibilities must still be explicit.

## First 10 minutes
1. Confirm whether the issue is real and customer-impacting.
2. Identify affected tenant(s), phone number(s), feature(s), and provider(s).
3. Check:
   - Render service health and deploy state.
   - BookedRadar /health and /ready.
   - active voice-call count and recent call-control logs.
   - OpenAI Realtime errors.
   - Twilio call/transfer state.
   - CRM/messaging provider failures.
4. Freeze unrelated production changes.
5. If a recently enabled feature is implicated, disable or revert that feature before altering the proven core path.
6. Preserve the proven SIP REFER human-transfer fallback.
7. Never reuse another tenant's credentials, phone route, or human-transfer target as a shortcut.

## Safe degradation hierarchy
When a feature fails, fall back in this order where applicable:
1. Normal configured BookedRadar flow.
2. Proven reduced feature set (for example confirm-only rather than live booking).
3. Proven REFER human-transfer path.
4. Customer's documented carrier forwarding/voicemail contingency.
5. Disable unsafe customer-facing automation rather than guessing.

## Customer communication
Customer updates should answer:
- What is affected?
- When did it begin?
- What is BookedRadar doing now?
- Is there a safe workaround?
- When will the next update be provided?
- What was the final impact and resolution?

Do not speculate about causes before evidence supports them.
Do not claim "no data loss" until persistence has been verified.

## Recovery verification
Before declaring resolved:
- Normal inbound call succeeds.
- Correct tenant/business identity is loaded.
- Lead persistence succeeds.
- Human request reaches the proven transfer path.
- CRM/notifications required by the active package succeed or are explicitly degraded.
- No cross-tenant state or routing contamination is present.
- Health/ready endpoints are clean.
- Relevant provider dashboards/logs show recovery.

## Rollback rule
Rollback when:
- A recent release plausibly caused the incident, and
- the prior version is known-good for the affected path, and
- rollback creates less risk than forward-fixing.

A rollback is not a failure. It is a reliability control.

## Postmortem
Required for every SEV-1 and meaningful SEV-2.

Document:
- Customer impact.
- Detection method.
- Timeline.
- Technical root cause.
- Contributing conditions.
- What worked.
- What slowed recovery.
- Why existing tests/monitoring did not prevent or detect it sooner.
- Corrective actions with owner and due date.

Postmortems are blameless. They exist to improve systems and process.

## Closeout
An incident is not fully closed until:
- service is restored,
- customer communication is complete,
- corrective actions are captured,
- monitoring/test coverage is improved where appropriate,
- and any temporary emergency configuration has been removed.
