# BookedRadar Observability Plan

## Objective
Detect customer-impacting failures before customers report them.

## Golden call journey
Every inbound voice call should be traceable across:
1. provider presented call
2. OpenAI incoming webhook received
3. BookedRadar call-control started
4. call accepted
5. sideband opened
6. first assistant audio observed
7. lead captured/persisted
8. CRM/recovery write
9. human transfer requested when applicable
10. companion SMS attempted
11. REFER attempted/completed when observable
12. call closed cleanly

Use a stable call ID and tenant ID on every log/event.

## Required metrics
Per tenant and globally:
- inbound calls
- accepted calls
- no-tenant-route rejections
- acceptance latency
- first-audio latency
- greeting retry/fallback count
- calls with no useful lead
- persistence failures
- CRM sync failures
- transfer requests/success/failure
- SMS companion success/failure
- realtime errors
- abnormal disconnects
- active calls
- application CPU/memory
- provider API error rates

## Initial alerts
Alert when:
- repeated incoming-call failures occur in a short window
- no-first-audio/greeting fallback rate rises above baseline
- any cross-tenant invariant violation occurs
- lead persistence fails
- transfer failures cluster
- authentication/provider credential errors repeat
- application restart/deploy loops appear
- storage approaches hard limits

Alerts should be actionable and mapped to a runbook.

## Dashboards
### Operations dashboard
- current active calls
- last 60 min calls / accepts / failures
- greeting latency distribution
- transfer success
- persistence/CRM error count
- current deploy/version
- provider status summary

### Customer dashboard
Show only tenant-scoped data:
- calls handled
- useful opportunities
- transfers
- knowledge gaps
- recovered opportunities
- confirmed revenue
- unresolved service issues

## Synthetic monitoring
Private synthetic numbers must be unpublished and separate from prospect demos.

Synthetic scenarios:
- routine HVAC
- urgent plumbing leak
- electrical safety concern
- roofing/storm damage
- ambiguous multi-trade request
- explicit human request
- Spanish call
- returning caller
- unknown business-policy question

Run synthetic calls on a schedule only after private test infrastructure exists.

## Logging standard
Every operational event should include when available:
- timestamp
- event name
- tenant_id
- call_id/opportunity_id
- provider
- outcome
- latency/duration
- safe error code

Do not place API keys, full payment data, passwords, or unnecessary caller PII in logs.
