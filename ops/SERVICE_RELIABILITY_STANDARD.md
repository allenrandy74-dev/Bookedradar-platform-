# BookedRadar Service Reliability Standard

## Principle
World-class service means detecting failures quickly, degrading safely, restoring service predictably, and proving what happened.

These are internal engineering/service targets until enough production history exists to publish contractual SLAs.

## Core service indicators

### Voice availability
Track:
- inbound calls presented,
- calls accepted,
- calls reaching first assistant audio,
- calls ending normally,
- calls transferred,
- transfer failures,
- calls with unexplained silence,
- calls rejected because of routing/configuration.

### Greeting performance
Track:
- webhook received → call accepted,
- call accepted → sideband open,
- sideband open → first assistant audio.

Alert on sustained regression, not a single noisy sample.

### Lead durability
Track:
- calls with usable service need + callback,
- lead persistence success,
- CRM synchronization success,
- recovery-opportunity creation success,
- duplicate/cross-tenant anomalies.

### Human escape path
Track:
- transfer requests,
- companion-SMS success,
- REFER attempts,
- transfer completion where observable,
- fallback failures.

### Provider health
Monitor separately:
- OpenAI Realtime,
- Twilio voice/SIP/SMS,
- Render,
- CRM provider,
- transactional email provider,
- Stripe,
- scheduling provider when enabled.

A provider outage must not be misreported as BookedRadar application health.

## Initial internal objectives
These are engineering goals, not external guarantees:
- No known cross-tenant routing/data event.
- 100% of enabled tenants have a configured human escalation target.
- Every production release passes automated tests and required acceptance checks.
- Every enabled customer-facing feature has a documented fallback or disable path.
- Every SEV-1/SEV-2 produces a reviewed incident record.
- Backups are considered valid only after a successful restore drill.

## Alert philosophy
Alert on conditions requiring human action:
- repeated call-accept failures,
- elevated no-first-audio rate,
- repeated transfer failures,
- persistence errors,
- cross-tenant invariant violations,
- service restart loops,
- provider authentication failures,
- abnormal latency/error-rate increases.

Avoid alerting on normal one-off noise.

## Release safety
Production change sequence:
1. Automated syntax/tests/simulation.
2. Isolated concurrency/regression tests.
3. Private synthetic acceptance when available.
4. Deploy.
5. Verify health and startup readiness.
6. Verify a controlled non-customer smoke path.
7. Observe early production metrics.
8. Roll back on defined regression signals.

Public demo numbers are prospect-facing assets and should not be used for load tests during active selling.

## Capacity
Before publishing concurrency claims:
- prove same-tenant and cross-tenant simultaneous calls,
- record provider/account concurrency limits,
- measure application CPU/memory under realistic call-control load,
- and document the tested production ceiling with safety margin.

## Customer-visible reliability
Never publish an uptime/SLA percentage based on assumptions.
Only publish measured service performance after the measurement pipeline is operating consistently.
