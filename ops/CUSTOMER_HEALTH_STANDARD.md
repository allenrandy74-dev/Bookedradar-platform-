# BookedRadar Customer Health Standard

## Principle
Customer health must be explainable. BookedRadar does not use a hidden numerical score to label a customer.

Statuses:
- **HEALTHY** — no known operational or readiness concern.
- **WATCH** — service is operating, but one or more conditions deserve proactive review.
- **AT_RISK** — a material reliability/readiness condition can affect customer value or trust.
- **NO_DATA** — insufficient operating evidence to make a meaningful assessment.

## Evidence groups

### Reliability
- voice-health assessment
- first-audio failures
- transfer failures
- durable lead-persistence failures
- provider / sideband errors
- CRM sync failures

### Readiness
- tenant readiness blockers
- disabled/gated capabilities relative to sold scope
- expired/invalid credentials
- missing human escalation
- incomplete acceptance requirements

### Delivery
- failed recovery actions
- failed human alerts/tasks
- unprocessed critical work
- unexpected routing failures

### Value
Value evidence is displayed but should not be used to hide reliability problems:
- opportunities captured
- recovered opportunities
- confirmed revenue
- customer-confirmed outcomes

Estimated opportunity value remains separate from confirmed revenue.

## Status rules
AT_RISK when any are true:
- tenant readiness has a blocker for an active/sold capability
- voice health is critical
- critical human-alert/task actions have failed
- durable lead persistence has failed
- known cross-tenant/routing safety issue exists

WATCH when there is no AT_RISK signal and any are true:
- voice health needs attention
- non-critical recovery actions have failed
- CRM sync failures occurred while durable lead capture remained safe
- customer value review is due/overdue
- repeated unresolved knowledge gaps or support issues exist

HEALTHY only when:
- no AT_RISK or WATCH signal exists, and
- there is enough recent operating evidence to assess the customer.

NO_DATA when:
- there is no material defect, but recent operating evidence is insufficient.

## Retention response
For WATCH:
- review the concrete signal
- contact the customer proactively when it materially affects their experience
- correct configuration/quality issues before discussing upgrades
- set a follow-up date

For AT_RISK:
- assign an owner
- resolve reliability/readiness issue first
- communicate clearly
- verify recovery
- conduct an incident or repeat-issue review when appropriate

## Review cadence
- Day 1 after activation
- Day 7
- Day 30
- monthly thereafter for active customers initially
- immediately after a meaningful incident or major configuration change
