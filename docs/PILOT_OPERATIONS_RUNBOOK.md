# BookedRadar first-pilot operations runbook
Status: procedure prepared; live alert delivery and production restore drill remain open.

## Before activation
Record primary/backup operational contacts and support hours in the customer order.
Record the customer's current phone-forwarding settings and exact carrier-specific
undo steps. Confirm who can reverse forwarding. Keep secrets outside this document.
Check tenant readiness, synthetic acceptance, customer acceptance and signed scope.
Verify actual CRM/email/SMS receipt. Confirm alerts reach an owner and a backup.

## If calls or transfers fail
1. Identify the affected tenant and last known good call/deploy; preserve timestamps.
2. Stop further expansion and notify the authorized operational contact through an
   approved channel. Do not promise a restoration time without evidence.
3. If callers are being lost, have the authorized operator restore the customer's
   previous phone routing using the recorded carrier instructions.
4. Check service health, deployment status, integration errors and provider incidents.
5. Correct or roll back to the recorded known-good release. Re-test before reactivation.
Do not change all tenants to fix one customer's route, rotate unrelated credentials,
or alter the working phone route as an unannounced diagnostic.

## Integration failure or payment failure
Confirm retry/idempotency behavior and inspect the per-tenant queue. Reconcile provider
acceptance versus actual receipt before retrying a notification; prevent duplicates.
Billing past_due is an operator attention state, not automatic permission to suspend
voice. Follow only the final customer agreement's notice and cure procedure.

## Backups and recovery
The backup helper now encrypts state with AES-256-GCM and covers recovery, voice,
lead, transfer and billing state. A synthetic isolated restore passed, including wrong-key
and overwrite rejection. Production restore acceptance remains OPEN.
Before launch, establish a protected backup destination, retention and access policy;
include recovery state, voice state/transfer state, lead records, billing state and
customer configuration. Never include API credentials in a customer-facing export.
Record recovery-point/recovery-time targets and obtain an isolated restore demonstration.
Do not restore an old state over a running service or replay notifications/payments.
Verify tenant isolation, event markers and pending actions before any controlled restart.

## First week
Review abnormal calls, missing intake, failed transfers, notification delivery, queue
failures and customer feedback daily. Track call minutes and direct service costs to
validate the agreed allowance. Broader coverage requires explicit review.

## Evidence log
Record: tenant; UTC/local time; symptom; call/event ID; provider delivery state; operator;
change/rollback; acceptance result. Keep personal information and credentials out of
shared launch reports. Customer-ready tagging remains pending the afternoon calls.

## Backup tooling (operator only)
Use `npm run backup` only against a stopped writer or an isolated consistent snapshot.
Set `BACKUP_QUIESCED=yes` only after establishing that condition; the helper does not
pause the service itself. Do not stop production during Randy’s call tests.
Supply `BACKUP_ENCRYPTION_KEY` as a 64-character hex secret through the approved secret
manager, never in chat or a committed file. Keep its protected recovery copy separate
from the archives. Set `BACKUP_DIRECTORY` to protected storage. Existing STATE_FILE,
RECOVERY_STATE_FILE, LEADS_FILE and BILLING_STATE_FILE overrides are honored.
The result lists missing stores and complete=false if any are absent; an empty backup
is rejected. Investigate missing files before accepting a production snapshot.

For isolated verification, set BACKUP_ARCHIVE, the same encryption key and a new
RESTORE_DIRECTORY, then run `node scripts/backup.js restore`. The directory must not
already exist. Restoration only writes files; it does not start the application or
replay events. Confirm expected tenants, event markers and pending actions before any
separately planned recovery. Source files must contain valid JSON/JSONL.

This archive excludes environment secrets and tenant configuration. Recover tenant
configuration from the protected versioned configuration and credentials from the
secret manager; establish and test those recovery paths separately. Offsite upload,
retention, scheduling, alert delivery and a production-data restore remain unverified.
