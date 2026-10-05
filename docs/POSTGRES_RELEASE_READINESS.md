# Durable provider receipts: PostgreSQL release gate

## Deployment boundary

This release requires the reviewed `db/postgres-schema.sql` revision before a PostgreSQL-backed server can start. `createPostgresServerStores` validates catalog metadata in a repeatable-read, read-only transaction before returning any stores. Server bootstrap awaits this before listening. A missing/incompatible schema stops startup with `postgres_release_schema_migration_required`; a failed metadata read stops it with `postgres_release_schema_validation_failed`. Neither case should be advertised as ready. JSON storage is unaffected. Existing production arming, source fingerprint, and validated migration checks remain mandatory.

The gate does not apply SQL, create tables, repair constraints, write probes, or log database URLs/driver errors. It checks the expected table inventory and this release's safety-critical columns, receipt object constraint, and usable immediate nonpartial unique indexes. It rejects global recovery-event idempotency uniqueness even when a tenant-scoped index also exists. It is a startup prerequisite check, not continuous drift detection or comprehensive database security certification. Do not change schema underneath serving processes; use the deployment/maintenance controls below.

## Required schema changes

- Permanent `bookedradar.provider_attempt_receipts`: non-null text attempt key with unique authority and non-null JSONB object payload. These fences have no expiry or automatic cleanup. Preserve pending/unknown and terminal records through backup/restore.
- Recovery-event idempotency: unique `(tenant_id, idempotency_key)` and removal of the old global unique constraint on `idempotency_key`. A unique standalone index with a different name can still impose the obsolete global rule and must be examined explicitly. The shipped SQL drops the known legacy constraint name only; it deliberately does not guess/drop arbitrary indexes.
- `CREATE ... IF NOT EXISTS` is not a schema repair mechanism. A same-name table/index with a different definition needs an explicit reviewed migration. A validated historical data migration does not prove these new prerequisites exist.

## Rehearsal and approval checklist

No production or existing lab migration is authorized by this document. Obtain separate approval for the actual destination, maintenance window, migration, and rollback plan.

1. Pin the exact application commit and SQL checksum. Capture current schema/index definitions and migration evidence with a read-only connection. Record existing global uniqueness, null tenant keys, tenant-key duplicates, and ambiguous historical ownership without exposing customer records in logs.
2. Back up data and permanent attempt receipts. Verify restoration to an approved isolated destination. Do not use customer data in a disposable test fixture without authorization.
3. Rehearse on a newly initialized disposable PostgreSQL fixture with synthetic prior-release schema/data. Run `test/postgres-release-readiness.integration.test.js`, followed by the full PostgreSQL suite. The integration suite drops/recreates its schema and must never target an existing lab/production database.
4. Test rejection of missing receipts, legacy global constraints and standalone indexes, partial/misleading indexes, incompatible receipt columns/checks, and absent validated production migration. Verify known-legacy schema upgrade succeeds and tenant-key replay remains isolated. Metadata inspection must also pass under database-enforced read-only mode.
5. Before any approved real migration, stop/drain all old and new writers and provider dispatch. Prevent rolling mixed-version traffic: old writers can assume global idempotency and do not honor permanent provider fences. Confirm no ambiguous in-flight provider effect is eligible for retry.
6. A qualified operator executes the separately approved migration transaction. Check both constraints and indexes structurally, including nonstandard legacy objects, then rerun the read-only prerequisite check. Resolve duplicate/ownership ambiguity explicitly; do not delete data or relax uniqueness to force success.
7. Start the pinned application only after schema, source fingerprint, migration validation, and independent release checks pass. Keep dispatch/customer activation disabled until their separate acceptance and authorization gates pass.

## Rollback

Application rollback is not automatically safe. Earlier code may ignore permanent attempt receipts or incorrectly deduplicate tenant events globally. Stop/drain writers and provider traffic first. Preserve the receipt table and every pending/unknown intent; never remove fences or retry an uncertain provider effect merely to restore service.

Do not blindly re-add global idempotency uniqueness: two tenants can legitimately share the same event key after upgrade, causing that rollback to fail or corrupt semantics. Prefer a forward fix with the current safety gates while traffic is paused. If an older release must be restored, separately review data compatibility, tenant-key collisions, receipt honoring, and reconciliation; use an approved restore only after accounting for post-backup provider effects. Restart only after the target version's validated prerequisites pass. Record precisely which code, schema, data snapshot, and external-effect reconciliations were restored.
