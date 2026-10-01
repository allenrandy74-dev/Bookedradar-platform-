# Incident-table repair and recovery evidence

The September 29 recovery drill found `bookedradar.ops_incidents` missing from both production and its restored copy. Its definition was already present in `db/postgres-schema.sql`. The repair extracts only that table and its scope/status index from the canonical schema, applies them transactionally, and verifies column types, nullability, primary key and index. It neither reimports state nor enables alerts.

Inspect first, with credentials provided through the approved private environment:

```sh
OPS_REPAIR_EXPECTED_HOST=<reviewed-database-host> node scripts/repair-ops-incidents.mjs
```

After the target has been reviewed and the repair has passed in an isolated database, apply it with the same expected host and `--apply`. `DATABASE_URL` is required. Do not paste credentials into tickets, chat, command history or this document. The default mode is read-only; application requires the explicit flag. Verification failure rolls back the additive repair. An incompatible existing table requires separate investigation; the script does not alter its columns.

For source/copy content comparison, `scripts/recovery-content-compare.mjs` requires `SOURCE_DATABASE_URL`, `RESTORE_DATABASE_URL`, `SOURCE_EXPECTED_HOST` and `RESTORE_EXPECTED_HOST`. It uses distinct host guards and read-only repeatable-read snapshots, compares every present table's row count and sorted row fingerprint, and emits aggregate results without customer rows or fingerprints. A missing table on both sides does not prove schema completeness; inspect expected tables separately. MD5 here is a consistency check, not an adversarial integrity guarantee. Concurrent production changes can produce legitimate differences between snapshots.

## Recorded execution

- 2026-09-30 01:06:47 UTC: source and restore matched across 17 tables and 1,208 rows before repair.
- 01:08:49 UTC: isolated repair succeeded twice. Actual incident-store suppression, notification release and resolution passed; synthetic fixtures were rolled back, leaving zero incidents.
- 01:09:42 UTC: the additive production repair succeeded, verifying 10 columns and the scope index; no synthetic production records were inserted.
- 01:10:11 UTC: final source/copy comparison matched across 18 tables and 1,208 rows, including the new empty incident table.

Application deployment, routing and billing were unchanged. This closes the missing-table defect and content reconciliation; it does not establish primary/backup email receipt, application failover acceptance or a customer RPO/RTO commitment. Randy approved permanent deletion at 20:16 CDT on September 29. Render subsequently returned to four permanent resources, with production Deployed and its original database Available. The temporary recovery copy is deleted; its final prorated invoice amount remains unverified.
