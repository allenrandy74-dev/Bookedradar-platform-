# BookedRadar Postgres Shadow Migration Runbook

> Historical migration procedure. As of September 29, 2026, production uses authoritative Postgres and two stateless application instances, per the handoff and public health evidence. References below to current JSON production describe the earlier migration phase. Do not re-run migration or shadow-import steps against current production. See [launch closeout](../docs/LAUNCH_CLOSEOUT_2026-09-29.md) and [pilot operations](../docs/PILOT_OPERATIONS_RUNBOOK.md) for current gates.

## Objective
Move BookedRadar toward managed Postgres without making the database authoritative until a full import and reconciliation have passed.

The current JSON/JSONL state remains the production source of truth throughout this phase.

## Current managed database
A paid managed Postgres instance has been provisioned in the same Render region as the BookedRadar application.

Security posture:
- external IP allowlist remains empty
- do not open external access just for testing
- use Render's private/internal database connection from the BookedRadar service
- never paste the database password or connection URL into chat, source control, logs, tickets or email

## Phase A — Dry-run audit
Default behavior is dry-run.

Required source files:
- state.json
- recovery-state.json
- leads.jsonl
- call-history.json
- web-chat.json
- voice-transfers.json when present
- growth-metrics.json when present
- billing-test-state.json when present
- billing-live-state.json when present

Run:
```
npm run migration:shadow
```

Dry-run must:
- touch no database
- validate tenant relationships
- validate recovery idempotency
- validate call/lead tenant consistency
- validate billing test/live separation
- produce counts and a SHA-256 snapshot fingerprint
- report warnings separately from errors

A real import is blocked by warnings unless explicitly reviewed.

## Phase B — Private database binding
In Render, bind the BookedRadar web service to the managed Postgres **internal** connection as `DATABASE_URL`.

Do not expose the database publicly.
Do not copy the connection string into documentation.

Keep:
```
POSTGRES_MIGRATION_ARMED=false
POSTGRES_MIGRATION_DRY_RUN=true
```

Binding the secret must not by itself change BookedRadar's active storage path.

## Phase C — Shadow import
Only after a clean dry-run and controlled window:

```
POSTGRES_MIGRATION_ARMED=true
POSTGRES_MIGRATION_DRY_RUN=false
POSTGRES_MIGRATION_ALLOW_WARNINGS=false
```

Run the migration command in a controlled one-off execution context.

The runner:
1. loads and audits the file snapshot
2. connects to Postgres
3. applies schema atomically
4. imports/upserts every store category in one transaction
5. reconciles every target-table row count
6. marks the migration validated
7. performs **no application cutover**

If any import write fails, the import transaction rolls back.
If reconciliation fails, do not cut over.

## Phase D — Reconciliation
Validate:
- migration fingerprint recorded
- calls match
- transcript turns match
- leads match
- contacts/opportunities/actions/attribution match
- web chat matches
- transfer records match
- billing test/live stores remain separate
- growth metrics match
- no cross-tenant relationships appear

Also inspect representative tenant records, not only totals.

## Phase E — Dual-write/cutover engineering
Do not switch production to Postgres immediately after a successful shadow import.

Next:
1. add Postgres implementations behind existing store interfaces
2. test them with the same existing suite
3. operate a controlled dual-write period if needed
4. compare file and database state
5. freeze/backup file state for final cutover
6. switch one store class at a time or through a tested atomic configuration gate
7. preserve rollback until stability is proven

## Rollback
Before Postgres is authoritative, rollback is simply:
- keep current file stores active
- disable migration/dual-write flags
- investigate database copy independently

After future cutover, the rollback procedure must be separately accepted and tested.

## Hard guardrails
- Never use the public demo numbers for database load testing.
- Never combine the database cutover with voice routing, transfer, credential, billing, or major prompt changes.
- Never delete the file-state backup immediately after cutover.
- Never label migration successful based only on row counts when integrity checks fail.
- Never open the database IP allowlist merely for convenience.
