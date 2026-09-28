# BookedRadar Managed Postgres Migration Plan

## Why
Current production uses JSON/JSONL state on a persistent Render disk. That is suitable for a controlled pilot but creates a single-instance limitation and prevents zero-downtime deployments.

Goal: move durable application state to managed Postgres so BookedRadar application instances can become stateless and horizontally scalable.

No paid database should be provisioned until explicitly approved.

## Stores to migrate
Current durable stores include:
- call control / processed webhook state
- call history and transcript metadata
- recovery contacts
- opportunities
- queued actions / leases
- growth metrics
- billing state that is not already authoritative in Stripe
- web-chat sessions
- lead records
- transfer metadata

## Database design principles
- tenant_id on every customer-owned row
- stable primary IDs
- foreign keys where appropriate
- unique idempotency keys
- timestamps in UTC
- transactional updates for opportunity/action state
- indexes for tenant + recency queries
- explicit retention/archive behavior
- no cross-tenant query without tenant predicate in application adapters

## Suggested logical tables
- tenants
- calls
- call_turns
- webhook_receipts
- contacts
- opportunities
- opportunity_events
- recovery_actions
- lead_captures
- transfer_events
- web_chat_sessions
- web_chat_messages
- growth_events
- billing_customer_state

Stripe remains the source of truth for payment/subscription objects; local billing tables store only BookedRadar state needed for orchestration.

## Migration sequence
1. Add database adapter interfaces behind existing store APIs.
2. Build Postgres schema/migrations.
3. Add Postgres implementation with tests.
4. Export file-state snapshot into migration format.
5. Import into isolated Postgres.
6. Compare row counts and critical invariants.
7. Run application integration tests against Postgres.
8. Run private synthetic voice/CRM/recovery tests.
9. Enable dual-write in a controlled environment if needed.
10. Schedule production cutover.
11. Quiesce writers briefly if required.
12. Take encrypted final file snapshot.
13. Import delta/final state.
14. switch reads/writes to Postgres.
15. verify calls, transfers, recovery, RadarProof and billing state.
16. retain rollback snapshot.
17. remove persistent disk only after stable observation.

## Rollback
A cutover is reversible until file-state retirement.

Rollback triggers include:
- missing/duplicate opportunity records
- tenant-isolation discrepancy
- call persistence failure
- action queue duplication
- significant latency regression
- billing-state mismatch

## Completion criteria
- all durable-state tests pass against Postgres
- backup/restore for Postgres is tested
- application can run without persistent disk
- at least two application instances can serve traffic safely
- zero-downtime deployment is verified
- measured concurrency test passes with safety margin
