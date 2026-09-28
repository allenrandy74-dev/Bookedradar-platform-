# BookedRadar World-Class Operations Roadmap

## Phase 1 — Protect the first customers
Status: start immediately, no public-demo load testing.

- Incident response runbook.
- Reliability/service-indicator standard.
- Customer-success operating cadence.
- Isolated concurrency tests.
- Backup/restore verification.
- Production change freeze during incidents.
- Feature-specific fallbacks and disable switches.
- Customer-specific acceptance before activation.

## Phase 2 — Detect before the customer
- Private unpublished synthetic phone numbers.
- Automated scripted voice checks.
- Alerting for no-first-audio, failed accept, transfer failure, persistence failure.
- Provider-health monitoring.
- Central incident timeline/evidence collection.
- Support queue with severity and ownership.

## Phase 3 — Remove single-instance state
Current limitation: file-backed state on one Render instance with persistent disk.

Migration goal:
- managed Postgres for durable operational/customer state,
- stateless application instances,
- transactional/idempotent writes,
- migration validation and rollback plan,
- preserve tenant isolation and RadarProof semantics.

Do not provision paid production infrastructure without explicit approval.

## Phase 4 — High availability
After state migration:
- at least two application instances,
- zero-downtime deploy strategy,
- capacity/load tests on private infrastructure,
- tested provider concurrency limits,
- controlled canary/rollback process.

## Phase 5 — Security/compliance maturity
- MFA everywhere supported.
- least-privilege access review.
- secret rotation schedule.
- dependency/vulnerability scanning.
- provider/vendor inventory.
- audit/event retention policy.
- documented data flows and retention.
- security incident procedure.
- evidence collection suitable for future SOC 2 readiness.

## Phase 6 — Customer-success maturity
- Day 0/1/7/30 operating cadence.
- Customer health score.
- proactive churn-risk queue.
- periodic business review for larger customers.
- RadarProof value narrative based on confirmed outcomes.
- systematic Knowledge Gap improvement loop.

## External claims rule
Do not publish claims such as:
- "unlimited simultaneous calls",
- "99.99% uptime",
- "zero missed calls",
- "guaranteed revenue",
unless BookedRadar has measured evidence and the commercial/legal language supports the claim.
