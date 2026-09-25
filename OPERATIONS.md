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
- Confirm startup validates all eight package prices and billing remains disarmed until separately authorized.
- Confirm the intended voice-transfer mode, tenant adapters, confirm-only booking and dispatch gates.
- Use read-only production checks for routine deployments. Run synthetic intake only when the changed behavior requires it, under a documented test tenant and cleanup plan.
- Inspect due actions without dispatching them. A deployment is not permission to send messages or enable live dispatch. Any delivery test needs its authorized internal recipient and a unique test identifier.
- Confirm RadarProof separates estimated and confirmed values.

## Failure handling
- Provider outage: dispatcher leaves unconfigured/failed work pending or failed; do not silently mark it sent.
- Duplicate provider webhook: source `idempotencyKey` prevents duplicate opportunity creation.
- Worker crash: action lease expires and can be reclaimed.
- Customer opt-out: suppression blocks later automated outreach.
- Unknown inbound phone number: voice layer rejects the call instead of guessing the tenant.
- Safety-sensitive call: operator escalates instead of diagnosing hazardous conditions.

## Backup
Follow `docs/PILOT_OPERATIONS_RUNBOOK.md`. `npm run backup` requires a protected encryption key and a stopped writer or genuinely consistent snapshot. The command does not stop writers itself. Never mark a hot file copy as a consistent backup.

The helper covers eight state stores, including separate live/test billing, call history and web chat. Review missing stores; a successful archive write alone does not prove complete recovery. Offsite destination, separate key custody and an isolated production-data restore must be verified before accepting backup readiness.

For a production database, replace the file backup with database-native snapshots before scaling beyond a controlled pilot.

## Automatic dispatch
The worker interval does not authorize delivery. Keep `DISPATCH_ENABLED=false` and tenant dispatch in shadow mode until the customer-specific channel acceptance and authorization are recorded. Provider failures back off exponentially and eventually appear in the failed-action admin view.
