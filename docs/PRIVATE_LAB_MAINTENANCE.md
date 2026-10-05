# Private-lab maintenance, backup and release procedure

## Status and authority

This is a deployment plan, not execution authorization. Preparing, testing or
publishing code does not authorize changing Render settings, deploying, exporting
data, migrating a database or creating paid resources. Obtain one explicit,
bounded approval naming the reviewed maintenance commit, final application commit,
service, database, temporary lab downtime, setting changes, backup destination and
retention, restore verification, migration and acceptance steps below. Stop before
any unapproved extension. Production and external provider actions are excluded.

Target service: `srv-datin02d0e5s73c94bqg`,
`bookedradar-private-voice-lab-20260929`.
Target database: `dpg-datimd2d0e5s73c926tg-a`,
`bookedradar_private_voice_lab_20260929`, port 5432.
The observed predecessor is `dab669d1ea97c11ee70e154fb6f1c73e0674530c`.
Recheck these identities at execution; never substitute the production database.

## Maintenance interface

Keep the effective Docker command `node scripts/private-voice-lab-start.mjs`.
Set `PRIVATE_VOICE_LAB_MAINTENANCE` to exactly `true` only as part of an approved
maintenance deployment. Absent or `false` selects normal startup; other values
must fail closed. The maintenance process must validate lab identity before
listening and must not import the application, initialize stores, open a database
connection or start providers, workers or operational notifications.

Require `VOICE_ENABLED`, `DISPATCH_ENABLED`, `BOOKEDRADAR_BILLING_ENABLED`,
`OPS_ALERTS_ENABLED` and `WARM_TRANSFER_ENABLED` to be exactly `false`, and
`DEMO_NUMBER_PROVISION_MODE` exactly `off`. Any supplied startup-action flag ending
in `_ON_STARTUP` must be `false`. Retain all other isolation and forbidden-secret
presence checks without printing credential values.

Only GET/HEAD `/health` returns 200. Its response identifies maintenance,
`customerReady:false`, `databaseReady:false`, `databaseAccess:disabled`, service,
instance ID and commit. All other requests return 503. This is an infrastructure
health response, not application or database readiness. Do not present a green
Render health check as successful application acceptance during maintenance.

## Stage A: replace all application writers

1. Verify Auto-Deploy remains off, the private wrapper is the effective command,
   and no pre-deploy command or startup migration is armed. Record exact candidate
   commits and the authorized non-secret setting delta. Settings changes can
   trigger deployment; choose the reviewed deployment sequence before saving.
2. Check active calls and work, all service instances, one-off jobs and any other
   known lab writers. Do not start while calls or uncertain in-flight work remain.
   Disabled voice and a zero-session database snapshot are not a continuing lock.
3. Deploy the pinned maintenance candidate with maintenance explicitly enabled.
   Do not apply DDL during this deployment or in a pre-deploy command.
4. Wait for the entire deployment to succeed. Verify **both** replacement
   instances identify the maintenance commit/mode, and both original application
   instances have terminated. Record per-instance evidence from the deployment,
   logs and instance inventory. Repeated load-balanced health responses do not
   prove that every instance was replaced. If any instance failed, reverted or
   remains an application writer, stop.
5. Reconnect Dashboard Shell to a verified maintenance instance. Recheck there
   are no independent lab writers or active calls/transactions. Keep maintenance
   mode ON and provider gates OFF throughout backup, restore verification and DDL.

Render's documented rolling deployment keeps old instances running while new
instances become healthy. After routing changes it waits 60 seconds before
SIGTERM, followed by the configured shutdown delay (default 30 seconds). Scaled
services replace instances sequentially and a failed rollout can revert. Elapsed
time alone is therefore not proof of quiescence. Inspect actual completion.
Do not suspend the service and assume its Shell remains available.

## Stage B: preserve and prove the actual database backup

1. Once writers are quiesced, read and record actual catalog structure, counts,
   sequence state and private content fingerprints needed for reconciliation.
   Include every lab table, historical receipts, suppression, aliases, booking
   history, ops incidents/notifications and migration provenance. Do not substitute
   the platform JSON export for a complete database backup.
2. With explicit backup approval, use Render database Recovery -> Create export.
   Wait for the actual export to complete. Do not confuse its creation with a
   successfully downloaded or restorable archive. Record creation time and keep
   the service in maintenance; any intervening writer invalidates the snapshot
   comparison and must be reconciled before proceeding.
3. Download the actual rendered export link using the supported browser download
   workflow. Register `tab.playwright.waitForEvent('download')` before clicking the
   link, then obtain the completed `download.path()`. Never print or reconstruct
   signed download URLs, connection strings or credentials. A returned browser
   path is not proof of executor access: verify the file is readable, nonempty and
   complete in the authorized private workspace, then record its checksum. If
   materialization fails, stop before migration; do not claim a backup succeeded.
4. Inspect archive members before extraction; reject traversal, absolute paths,
   unsafe links and unexpected executable database objects. Restore the directory
   archive with compatible PostgreSQL 18 tools into a fresh, isolated database in
   the already approved private workspace. Use no production credentials, provider
   configuration or public network listener. Never restore over the live lab.
   Preserve the complete original archive even if the validation restore remaps
   ownership or excludes grants. Record such differences explicitly.
5. Prove restored tables, data fingerprints, sequences, constraints and receipt/
   suppression/ops history match the quiesced source. A synthetic restore test or
   successful archive listing alone is insufficient. Keep the verified backup
   outside Render's ephemeral service filesystem across subsequent deployments.
   Follow the approved retention and cleanup scope; permanent deletion needs its
   own applicable confirmation.

Render retains logical exports for at least seven days. Its PITR creates a
separate database and cannot target the latest ten minutes. PITR verification is
not verification that a particular downloaded logical archive restores correctly.
Additional recovery databases, one-off jobs, API credentials or storage services
are not included in this plan. Obtain specific cost/access approval before any
such alternative. Do not upgrade the workspace or open inbound database access.

## Stage C: migrate and resume the pinned candidate

1. Reconfirm maintenance on both instances and no other writers. Compare actual
   old schema with the reviewed predecessor fixture. Unexpected drift or
   incompatible data/indexes is a stop condition, not permission to repair blindly.
2. In one authorized Shell maintenance session, apply only the reviewed
   transaction-bounded DDL: permanent provider-attempt receipts and tenant-scoped
   recovery-event uniqueness, preserving lab-only schema and existing data. Use
   bounded lock/statement timeouts. Never make application startup auto-migrate.
3. Read back schema/index semantics and preserved data/sequence fingerprints;
   run the approved non-mutating release-readiness checks. Do not proceed after
   an uncertain commit until catalog/data reconciliation establishes its outcome.
4. Deploy the exact final application commit with maintenance explicitly `false`
   (or absent), keeping the private wrapper and all provider gates off. Verify the
   setting/code transition is the one approved. Exact-commit deployment does not
   inherently require a merge; if using the lab branch, include its merge and the
   resulting verified commit in the authorization. Never merge to production.
5. Verify full deployment completion, both instances' application startup and
   listen/health, durable schema readiness, synthetic tenant isolation and all
   disabled provider gates. Then run only the approved bounded synthetic
   rehearsal. A maintenance response or preflight-only log is not acceptance.

## Failure and recovery

On any failure, retain maintenance mode and stop dependent actions. Preserve the
latest database and backup evidence. Prefer a reviewed forward correction. A code
revert does not undo schema or provider effects; a pre-change restore can erase
later receipts. Do not restart the predecessor application against a changed
database, drop attempt records, clear unknown outcomes, or restore an old snapshot
without explicit compatibility/reconciliation review and applicable approval.
Keep a tested maintenance image available as the non-writing holding state.

## Official operational references

- Rolling lifecycle and ephemeral filesystem: https://render.com/docs/deploys
- Dashboard Shell and session closure: https://render.com/docs/ssh
- Native exports, isolated local restore and PITR: https://render.com/docs/postgresql-backups
- Optional paid one-off jobs, not used by this plan: https://render.com/docs/one-off-jobs

The documentation supports the proposed workflow; only actual execution evidence
can establish that a specific deployment, export, materialization or restore
succeeded. No such execution is implied by this runbook.
