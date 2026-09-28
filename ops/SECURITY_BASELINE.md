# BookedRadar Security Baseline

## Access
- MFA required wherever provider supports it.
- Individual accounts preferred over shared credentials.
- Least privilege for GitHub, Render, Twilio, OpenAI, Wix, Stripe, Resend and future providers.
- Quarterly access review.
- Remove access immediately when no longer needed.

## Secrets
- No secrets in source, issue bodies, logs, screenshots or customer email.
- Tenant-specific secrets remain isolated by tenant prefix/configuration.
- Rotate credentials after suspected exposure and on a documented schedule.
- Production and test credentials must remain distinct.

## Data
- Collect only information needed to service the caller/customer.
- Audio recording remains off by default.
- Transcript retention requires explicit approved scope.
- Redact obvious payment-number/SSN patterns from persisted transcripts.
- Define and enforce retention periods.
- Customer data must not cross tenant boundaries.

## Application controls
- Authenticate ingestion/admin APIs.
- Verify provider webhook signatures.
- Keep idempotency/duplicate protections.
- Reject unknown inbound routes rather than guessing a tenant.
- Preserve confirm-only behavior unless live scheduling is explicitly approved/tested.
- Customer-facing automation remains feature-gated.

## Software supply chain
- Pin production dependencies.
- Run syntax/tests/simulation before release.
- Enable automated dependency/vulnerability scanning.
- Review critical/high vulnerabilities before production deployment.
- Do not merge unreviewed emergency code after an incident without a follow-up review.

## Audit evidence
Retain evidence for:
- production deployments
- configuration changes
- incidents/postmortems
- customer acceptance tests
- access reviews
- secret rotation
- backup restore drills
- security findings and closure

## Security incident triggers
Treat as SEV-1:
- suspected cross-tenant exposure
- credential theft/exposure with production access
- unauthorized production modification
- material customer-data disclosure

During a security incident:
- preserve evidence
- rotate/disable affected credentials
- restrict access
- do not destroy logs
- involve qualified legal/security professionals where required
- communicate verified facts only
