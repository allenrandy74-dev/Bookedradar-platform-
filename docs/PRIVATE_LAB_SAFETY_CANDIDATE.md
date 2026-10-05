# Private-lab safety candidate and migration/backout runbook

## Scope and pinned sources

- Lab baseline: `dab669d1ea97c11ee70e154fb6f1c73e0674530c` (`lab/private-voice-runtime`).
- Reviewed safety source: PR96, `18eb83dee5656d5aafd0717fbd7905a20229f6eb`.
- This is a semantic lab integration, not a replacement with the production tree.
- Draft code/test publication only. No lab/production merge, deployment, migration, environment change, provider call or customer activation is authorized by this document.

## Preserved lab boundaries

The wrapper remains `node scripts/private-voice-lab-start.mjs`. The Dockerfile still defaults to `node server.js`; therefore its effective Render Docker command MUST be independently verified before a future deployment. The unchanged lab blueprint is `ops/private-voice-lab.render.yaml`, with automatic deploy disabled. A repository file does not prove the current remote setting.

The exact service name, managed database host/name, historical validated migration, five synthetic tenants, disabled voice setting, shadow/unarmed dispatch, disabled billing/alerts/warm transfers, missing customer integration credentials, non-dialable transfer target and disabled customer SMS/web-chat configuration remain required. No new test bypass is added to the deployed wrapper. Database URL query/fragment overrides and non-5432 ports are rejected; the normalized URL explicitly pins 5432 for both preflight and server so ambient PGPORT cannot redirect it.

The wrapper checks migration provenance and current release schema read-only before importing the server. `private_voice_lab.preflight_validated` is only preflight evidence; it is not evidence that the process listened, stayed healthy, or passed the platform health check. Server startup independently checks release schema as well.

## Reconciliation decisions

- `db/postgres-schema.sql`: preserve lab `ops_notifications` schema/FK/index, add permanent `provider_attempt_receipts`, replace legacy global recovery-event key uniqueness with tenant-scoped uniqueness. No business rows are deleted by these DDL changes.
- `server.js`: preserve notification IDs and accepted/uncertain ops receipt handling, recovery-health projection and historical booking review endpoint. Add durable transfer/attempt wiring and schema readiness. Apply inquiry reservation/completion receipt safety to the lab's existing contact/task capture without importing the production-only notes or public onboarding subsystem.
- `src/call-history.js`: add transactional JSON storage and immutable ownership; keep lab reporting behavior. Do not import production-only customer-result projections.
- `src/operator.js`: preserve called-party routing and lab reconciliation guidance; apply unconditional automatic-booking refusal guidance.
- `src/postgres-call-history.js` and `src/postgres-recovery-store.js`: apply transaction-safe in-memory views and durable recovery identity/monotonicity; preserve lab behavior.
- `src/postgres-schema-inspection.js`: preserve `ops_notifications` as required while validating new permanent receipt/index semantics.
- `src/postgres-server-stores.js`: retain tenant-specific historical booking review stores; add attempt/receipt APIs and release readiness.
- `src/postgres-state-store.js` and `src/state-store.js`: add permanent attempts and inquiry receipt APIs. New booking claims are denied before any SQL. Historical booking read/finish APIs remain for compatibility; no new provider-writing booking flow remains.
- Booking webhook and Google Calendar adapters: refuse writes unconditionally, including direct request helpers. Retain fail-closed advisory availability. Updated old tests that expected a provider write now assert zero calls and unavailable authority instead.
- `test/postgres-dispatcher.integration.test.js`: keep the lab's unverified email-receipt hold/restart regression alongside safety changes.
- `src/integrations/booking-once.js`: refuse before reads, claims, provider calls, result replay or new holds. Existing uncertain history is neither erased nor represented as resolved.
- SMS rehearsal's in-memory unit fixture now explicitly opts into the transactional store's memory-view helper; its production guard/cleanup contracts remain intact.

Two PR96 changed files are intentionally not ported: `test/customer-results-scope.test.js` and `test/fixtures/customer-results-cases.js`. They support the production-only customer reporting feature, absent from the lab baseline. No customer reporting/UI/onboarding feature is introduced solely to satisfy those tests. The inquiry safety tests are adapted only to omit the absent notes-write stage; contact/task partial-write, receipt failure, duplicate, TTL and ownership checks remain. Therefore test totals are not expected to equal the production PR's totals.

## Future deployment approval gate (not executed here)

1. Independently verify the exact target service/database identity, live head, effective wrapper command, automatic deploy OFF, current disabled flags and absence of external adapters. Stop on any mismatch or unverified protected setting.
2. Obtain explicit approval for the exact candidate commit, lab-only writer quiescence, backup, reviewed migration and deployment/rehearsal. Publishing this draft is not that approval.
3. Quiesce both lab instances and all lab writers. Verify no active calls, dispatches, scripts or background writers. Preserve receipts, suppression, aliases, historical booking attempts, ops incidents/notifications, and migration provenance. Never use an old snapshot alone after later side effects.
4. Create and verify an approved restorable backup of the entire lab database, including all tables, constraints, sequences and receipts. A JSON platform export is NOT a complete lab database backup: it cannot represent ops state and now fails closed if either ops table contains rows. The same shared snapshot gate blocks JSON rollback and the platform restore drill before data/files are changed. Record recovery evidence and the forward path before DDL.
5. Review the actual old schema against the pinned fixture and inspect duplicate keys/indexes. Unknown drift, missing notification schema, unavailable metadata, unvalidated migration or incompatible permanent receipts is a STOP condition. Do not make startup apply schema automatically.
6. Under a separate authorized migration session and transaction, apply only reviewed DDL from `db/postgres-schema.sql`: create the permanent receipt table and replace legacy global event-key uniqueness with tenant-scoped uniqueness. Preserve lab-only schema. Record catalog/data comparisons and read-only `validateLabReleaseReadiness` output. Existing arbitrary/renamed global indexes require reviewed remediation, not blind retries.
7. Deploy only the reviewed lab candidate with `node scripts/private-voice-lab-start.mjs`; keep every provider gate OFF. Require server listen/health and both instance readiness, not the preflight log alone. Run only the separately approved bounded synthetic rehearsal. Stop immediately on unexpected providers, writes, missing schema or isolation failure.

## Backout

Keep writers stopped and provider gates OFF. Prefer correcting forward while preserving the new permanent intent ledger. Do not drop permanent receipts, clear uncertain attempts, re-enable legacy booking, or restart older code against a changed database without compatibility review. A code revert cannot undo remote effects. A pre-upgrade restore would remove subsequent durable intent history; it requires separate approval, reconciliation and assurance no later effects or required data are discarded. Restore a latest compatible backup when possible and revalidate receipt/suppression/alias/ops state and schema before any restart.

## Evidence and limitations

Automated acceptance includes a byte-pinned old-lab SQL fixture, PostgreSQL read-only old-schema rejection, repeated migration with legacy table/sequence preservation, logical old/new restore, permanent uncertain-receipt replay fencing, preserved historical booking review, ordinary lab/PR96 safety regressions, lab SMS and ops tests. The synthetic logical restore is not `pg_dump`, PITR, a managed backup recovery test or a live Render rehearsal. Test harness transport guards cover trusted Node APIs, not OS-level isolation. Final counts and exact source hashes belong in the draft PR's evidence.

The environment has no Docker CLI; exact image build/container execution is not established by Node tests. No installation is attempted. Actual Render command/settings/schema/backup/active writers and post-deployment health remain unverified; deployment remains blocked pending those checks and explicit approval.
