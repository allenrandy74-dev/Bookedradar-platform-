# BookedRadar Stateless / High-Availability Cutover

## Goal
Remove the web service's persistent-disk dependency and run multiple stateless application instances against managed Postgres.

## Preconditions
All must be true:
- Managed Postgres is authoritative.
- POSTGRES_STATELESS_MODE=true.
- BOOKEDRADAR_STORAGE_BACKEND=postgres.
- POSTGRES_PRODUCTION_ARMED=true.
- Shadow import, migration audit, migration diff, JSON rollback-on-startup, and migration arm are disabled.
- Validated migration ID and fingerprint remain configured.
- Postgres health is clean.
- No active SEV-1/SEV-2 incident.
- No active voice calls at the change boundary.
- Lossless Postgres -> JSON rollback sync is tested.
- Managed Postgres restore drill is tested.
- Current JSON disk is retained until the final disk-removal action.

## Current architecture before disk removal
- 1 Render Starter web-service instance
- 1 GB persistent disk at /app/data
- Managed PostgreSQL 18 authoritative
- Stateless-mode contract enabled
- Health path /health
- Render auto-deploy disabled

## Render change sequence
1. Confirm the service is healthy and there are no active voice calls.
2. Remove the persistent disk from bookedradar-platform.
3. Allow the service to redeploy with an ephemeral filesystem.
4. Verify:
   - service becomes LIVE
   - Postgres startup health succeeds
   - no JSON migration/audit/rollback event runs
   - all five demo tenants report READY
   - integration preflight still shows CRM/email/human_task/human_alert
   - billing remains disarmed
   - dispatch remains shadow/unarmed
   - no startup errors
5. On the Compute page, set manual instance count to 2.
6. Verify two running instances are reported by Render.
7. Confirm both instances can connect to Postgres.
8. Verify normal health traffic is load-balanced without errors.
9. Do not run public-demo load tests; use the private synthetic lab when private numbers are provisioned.

## Rollback
If the disk-removal deploy fails before Postgres accepts new production traffic:
- restore the previous service configuration/disk and redeploy.

If Postgres is healthy but application code must fall back to JSON after Postgres has accepted new records:
1. scale down / stop new traffic safely
2. set BOOKEDRADAR_STORAGE_BACKEND=json
3. arm the tested POSTGRES_JSON_ROLLBACK_ON_STARTUP path
4. sync current Postgres authority back to JSON
5. require exact hash validation before JSON service starts
6. keep Postgres unchanged until recovery is complete

If Postgres itself is unavailable:
- use Render Postgres recovery / managed backups, not stale JSON as the primary data-recovery method.

## Multi-instance safety
- Voice call session state is scoped per active instance, while durable call state is in Postgres.
- Recovery dispatch claims are tenant-serialized and lease-fenced in Postgres.
- Webhook idempotency is durable in Postgres.
- Billing remains provider-authoritative with local orchestration state in Postgres.
- File-backed migration and rollback features are forbidden in stateless mode.

## Success criteria
- Persistent disk absent.
- Two app instances running.
- No startup or runtime errors.
- Postgres remains authoritative.
- All tenants READY.
- Provider integrations intact.
- Health checks passing.
- A subsequent normal deploy uses Render zero-downtime deployment behavior.
