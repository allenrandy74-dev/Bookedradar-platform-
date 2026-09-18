# BookedRadar Security Baseline

## Secrets
- Never commit OpenAI, Twilio, Wix, email-provider, or admin tokens.
- Production secrets belong in the hosting provider's encrypted environment store.
- Use a different `secretsPrefix` and provider credentials per customer where possible.
- Rotate any credential that appears in logs, screenshots, source control, tickets, or chat.

## Public vs private endpoints
- `/health` is intentionally minimal and safe for public health checks.
- Ingestion requires `BOOKEDRADAR_INGEST_TOKEN`.
- Admin mutations and dispatch require `BOOKEDRADAR_ADMIN_TOKEN`.
- RadarProof is private unless `RADARPROOF_PUBLIC=true`.
- Do not place customer API tokens in browser-side JavaScript.

## Customer data
- Transcript logging is off by default.
- Operational logs mask phone numbers.
- Do not collect payment-card numbers, SSNs, passwords, or unrelated sensitive data.
- Use the smallest practical data-retention window.
- Backups must receive the same protection as the primary state.

## Production scaling
The JSON state store is appropriate for a controlled single-instance pilot.
Before multi-instance or materially larger production traffic:
- move state/idempotency/action leases to a transactional database,
- use distributed rate limiting,
- place backups in encrypted durable storage,
- implement centralized structured logs and alerting.
