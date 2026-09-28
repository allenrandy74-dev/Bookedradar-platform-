# Postgres call-state adapter: isolated implementation

Production still uses JSON. `server.js` does not import or select these adapters.
There is no environment switch that activates them in this change.

`PostgresCallStateStore(pool, tenantId)` reads and merges call control records
inside PostgreSQL. Every read is tenant-scoped; updates cannot reassign an
existing call ID, including an imported record with a missing tenant. Such
records require explicit reconciliation before activation. Concurrent patches
merge top-level fields atomically; overlapping fields are last-writer-wins, as
with the JSON contract. Nested objects are replaced, not recursively merged.

`PostgresWebhookStore(pool)` claims a globally unique provider webhook ID
atomically. Claims expire after 24 hours. Release is for the processing owner's
failure path, not a general-purpose cross-worker cancellation API. Database
errors propagate, with no automatic fallback to a second persistence authority.
The adapter deliberately does not prune historical call records automatically.

## Recovery evidence

`exportPostgresCallState(pool, root, { writersQuiesced: true })` exports only
call-control state and webhook receipts in a consistent read-only transaction.
It creates a fresh private directory and `state.json`, never overwriting live
files. The caller must actually drain and stop all writers before asserting
`writersQuiesced`; this function cannot independently enforce an application
freeze. The isolated integration test opens that export with `JsonStateStore`
and verifies payloads and duplicate-event protection.

This is a component recovery drill, not complete production rollback. It does
not export call history, leads, recovery actions, chat, transfers, metrics or
billing. Do not switch production back to a stale JSON snapshot after database
writes. A full reverse export and reconciliation are required first.

## Tests

`npm test` includes adapter validation and database failure handling. It skips
the real PostgreSQL integration suite unless `POSTGRES_TEST_URL` is provided.
The dedicated CI job uses a disposable PostgreSQL 18 service and exercises
concurrent updates, tenant isolation, atomic duplicate claims, receipt expiry,
transaction rollback, fresh-store reads and export/reload. The suite accepts
only a loopback host and database `bookedradar_test`; it destroys that database's
`bookedradar` schema. Never point it at an existing application database.

## Remaining activation gates

- Adapt every store and direct in-memory reader, including recovery workers.
- Preserve tenant boundaries and atomic claiming for recovery and billing.
- Verify failure/retry behavior and multi-call load with isolated fixtures.
- Implement complete reverse export and prove restore of every store.
- Define and enforce the writer drain, final sync and reconciliation sequence.
- Approve a controlled production activation window with a tested rollback.

The existing shadow import is a point-in-time copy, not ongoing replication.
