# BookedRadar Operations Runbook

## Before deployment
1. Run `npm test`.
2. Run `npm run self-check`.
3. Confirm all tenant phone numbers are unique.
4. Keep all tenants in `confirm_only` booking mode until their real scheduler is verified.
5. Leave call recording off unless disclosure/consent requirements are intentionally implemented.

## Every deploy
- Verify `/health` returns `ok: true`.
- Verify `/ready` under the admin/security policy used by the deployment.
- Ingest one synthetic event for a test tenant.
- Inspect due actions without sending customer messages.
- Run a controlled dispatch to an internal test contact.
- Confirm RadarProof separates estimated and confirmed values.

## Failure handling
- Provider outage: dispatcher leaves unconfigured/failed work pending or failed; do not silently mark it sent.
- Duplicate provider webhook: source `idempotencyKey` prevents duplicate opportunity creation.
- Worker crash: action lease expires and can be reclaimed.
- Customer opt-out: suppression blocks later automated outreach.
- Unknown inbound phone number: voice layer rejects the call instead of guessing the tenant.
- Safety-sensitive call: operator escalates instead of diagnosing hazardous conditions.

## Backup
Run:
`npm run backup`

For a production database, replace the file backup with database-native snapshots before scaling beyond a controlled pilot.

## Automatic dispatch
With `DISPATCH_INTERVAL_SECONDS=30`, the worker sweeps overdue actions at startup and every 30 seconds. Provider failures back off exponentially and eventually appear in the failed-action admin view.
