# Customer portal: current status and next gates

## Verified status as of October 12, 2026

The isolated synthetic staging app has a Wix managed identity flow, verified tenant-bound opaque sessions, and durable workflow/note storage. Synthetic staging identity/session and durable-workflow acceptance were verified at `3f4430c5ce942ea00cfe8d47aa1203444f0925d9`. The earlier request to reconnect Wix, choose a login provider and create the first staging login client is historical and no longer the next action. See [staging authentication](server/STAGING_AUTH.md) for the implemented boundary.

The standalone preview remains memory-only and entirely synthetic. The staging app and its prior approval do not authorize loading customer records, another business membership, or production activation. Existing phone, CRM, recovery and billing behavior is outside this source-only change.

## Current source/test-only candidate

- The unchanged pure source mapper validates identity and preserves independent human workflow.
- A new inactive bounded tenant source reader and transactional importer add real-store lock fencing, immutable source bindings, compare-and-swap source refresh and separate service audit.
- A separate inactive migration defines only the new portal source-link/audit tables. No runtime, auth, UI, original schema or staging schema changes are made.
- All candidate testing uses fabricated data. The modules are disabled by default, have no CLI/environment activation, and are not imported by the running staging app.

Read [SOURCE_INGESTION.md](SOURCE_INGESTION.md) for the exact API, field/storage/access proposal, source evidence and limitations. See [SOURCE_MAPPING.md](SOURCE_MAPPING.md) for the unchanged field mapper.

## Next steps before any first-business read-only view

1. Review and finish exact-candidate synthetic unit and disposable PostgreSQL acceptance. Existing head/CI results cover only the code actually tested; future publication needs exact-head checks.
2. Choose one verified business tenant, finite record scope and intended viewer. Decide eligibility, pruned-history handling, retention and what happens when an already imported row becomes ineligible. The current candidate rejects its refresh but does not hide the old row; that is a live-use blocker.
3. Approve the exact customer-data destination/schema and minimal internal source-read / portal-write permissions. The current synthetic lab is not an implied real-data destination. Review database-level tenant enforcement and the cooperative recovery-write lock contract. Persistent access and secure credential provisioning require separate authorization.
4. Review and implement a bounded invocation/publisher and verified viewer access binding. The new importer is an internal library, not a mounted endpoint or scheduled job. Review customer DTOs, session revocation, cross-tenant isolation and audit/retention controls on the final composition.
5. Obtain separate approval for migration, real-data reads/transfers, deployment and customer access. No real-data activation, credentials, grants, providers, spending or customer invitations are included in this candidate.

The proposed first view contains name, email, phone, service subject, source and receipt time only. It excludes transcripts, arbitrary metadata/internal notes, monetary results, consent/provider state and action execution. A synthetic login or durable synthetic save is not evidence of a real booking, payment, customer reply or completed transfer.
