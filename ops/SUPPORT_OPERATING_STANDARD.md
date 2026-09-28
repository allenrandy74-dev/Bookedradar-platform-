# BookedRadar Support Operating Standard

## Purpose
Customer support is part of the product. A customer should never have to diagnose SIP, webhooks, API credentials, provider errors, or BookedRadar internals.

## Case ownership
Every support case must have:
- customer / tenant identifier
- time first observed
- reported-by: customer, BookedRadar monitoring, or provider
- impact statement
- severity
- accountable owner
- current status
- next action
- next customer update trigger
- related call IDs / provider IDs when safe
- workaround or safe-degradation state
- resolution and follow-up action

Do not put customer PII, caller transcripts, credentials, addresses, or private business details into a public GitHub issue.

## Case states
- **New** — received but not triaged.
- **Acknowledged** — BookedRadar owns it and has confirmed impact/scope.
- **Investigating** — root cause or provider dependency is being determined.
- **Mitigated** — customer impact has been reduced or safely bypassed.
- **Monitoring** — fix/mitigation is in place and being observed.
- **Resolved** — normal service is restored and verified.
- **Closed** — customer communication and required follow-up are complete.

## Severity

### SEV-1 — Critical
Examples:
- customer cannot reliably receive inbound calls through BookedRadar
- wrong-business / cross-tenant routing or data exposure
- callers are being stranded without a safe human/fallback path
- durable lead persistence is failing broadly
- multiple customers are materially affected

Use the Incident Response Runbook.

### SEV-2 — High
Examples:
- one customer has a material call-path disruption
- transfers fail repeatedly
- greeting/first-audio failures are recurring
- CRM/notification failures materially delay service but durable leads remain protected
- a key integration is degraded without broad outage

### SEV-3 — Normal
Examples:
- isolated configuration issue
- dashboard/report lag
- optional feature defect with a safe workaround
- non-urgent business-rule correction

### Request / Improvement
Use for non-defect questions, configuration requests, and enhancement ideas.

## Triage sequence
1. What is the customer impact?
2. Is the core voice path affected?
3. Is lead durability at risk?
4. Is the human escape path available?
5. Is the issue isolated to one tenant or shared?
6. Is a provider degraded?
7. What safe fallback exists right now?
8. What evidence identifies the failing stage?

## Support evidence hierarchy
Prefer:
1. BookedRadar operational milestones / health report.
2. Call-specific BookedRadar events.
3. Provider call/event IDs and status.
4. Tenant readiness/configuration state.
5. CRM/action queue evidence.
6. Customer description/recording when needed.

Do not ask the customer to reproduce a problem repeatedly if internal evidence can answer it.

## Customer communication standard
A useful update contains:
- what is affected
- what is not affected, if known
- what BookedRadar is doing
- safe workaround, if any
- what the customer needs to do, if anything
- when another update will be triggered (new evidence, mitigation, resolution)

Do not speculate about root cause.
Do not claim data was preserved until persistence is verified.
Do not blame providers or the customer.

## Engineering handoff
When support identifies a product defect:
- create a redacted engineering issue
- include safe call/event identifiers only
- describe expected vs actual behavior
- include reproducible internal evidence
- link the incident/support case privately outside public GitHub
- define acceptance criteria for the fix

## Repeat-issue rule
A second materially similar incident is not treated as “just another ticket.”
It triggers a review of:
- why the earlier corrective action did not prevent recurrence
- monitoring/test coverage
- runbook quality
- whether architecture or provider redundancy needs improvement

## Closeout
A customer-impacting case is closed only when:
- service is verified restored or request completed
- customer has been informed
- temporary workarounds are documented/removed as appropriate
- required engineering or operational follow-up is tracked
- repeat-risk has been considered
