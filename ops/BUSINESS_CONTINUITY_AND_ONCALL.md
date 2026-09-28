# BookedRadar Business Continuity and On-Call Standard

## Objective
BookedRadar must not depend on one person being reachable for customer-critical service.

## Roles
Maintain at least two documented roles:

### Primary operator
Owns normal production operations, customer support, deployments, and provider coordination.

### Backup operator
Can execute the emergency runbooks without needing to understand the entire codebase.

The backup operator does not need unrestricted daily access to every system. Emergency access should follow least privilege and be tested periodically.

## Backup operator must be able to
- identify whether BookedRadar or a provider is failing
- view the private operations dashboard
- identify affected tenant(s)
- activate the customer's documented phone fallback
- disable an unsafe optional feature
- verify the human transfer path
- check Render health/deploy state
- check Twilio/OpenAI/provider status
- locate the latest known-good release
- communicate an incident update to the customer
- escalate to technical help
- access the incident-response and restore runbooks

## Emergency access package
Maintain a secure, non-GitHub emergency package containing:
- provider/account inventory
- where credentials are stored
- how emergency access is granted
- billing/account ownership contacts
- domain/DNS ownership
- recovery codes where appropriate
- backup operator instructions
- legal/business contact details
- customer emergency contacts

Never commit recovery codes, passwords, secret keys, or complete credential exports to the repository.

## Operational continuity scenarios

### Founder unavailable
- Backup operator becomes incident commander for customer-impacting events.
- Use documented provider status, BookedRadar health, and fallback procedures.
- Avoid product changes unless necessary to restore safe service.

### Render unavailable
- Confirm provider status.
- Preserve/activate customer carrier fallback where required.
- Do not repeatedly redeploy during a provider outage.
- Communicate affected scope.

### OpenAI Realtime unavailable
- Treat voice AI path as degraded.
- Use customer-specific forwarding/voicemail/human fallback.
- Preserve lead recovery paths that remain available.

### Twilio/SIP unavailable
- Verify scope/account/region.
- Use the customer's carrier-level contingency if BookedRadar number/trunk is unavailable.
- Do not represent BookedRadar application health as proof the phone path works.

### CRM unavailable
- Durable BookedRadar lead capture remains authoritative for immediate continuity when available.
- Mark CRM synchronization degraded.
- Reconcile after provider recovery.
- Do not discard or duplicate leads during recovery.

### Database/state incident
- Stop unsafe writers if consistency is uncertain.
- Take/retain evidence.
- Follow restore/migration rollback runbook.
- Verify tenant isolation before resuming full traffic.

## Continuity drill cadence
Quarterly:
1. tabletop one provider outage
2. verify backup operator can find the runbooks
3. verify customer fallback instructions are current
4. verify emergency contact paths
5. verify latest known-good release is identifiable

At least semiannually:
- run an isolated restore drill using a real encrypted backup snapshot
- record measured recovery time and any gaps

## Founder dependency exit criterion
BookedRadar is no longer founder-dependent when a backup operator can complete a documented incident tabletop and customer fallback exercise without undocumented help.
