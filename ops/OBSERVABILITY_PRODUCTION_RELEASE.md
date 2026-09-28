# BookedRadar Observability Production Release Plan

## Goal
Release the already-merged operations-health and customer-health instrumentation without disrupting public prospect demo traffic.

This plan does **not** authorize a deployment. It defines the safe deployment procedure.

## Why this release is different
The changes add:
- durable operational call milestones
- protected voice-health endpoint
- protected customer-health endpoint
- private Ops Health dashboard
- no intended caller-facing prompt, routing, transfer, or package changes

Because production currently runs one Render instance with persistent disk, a deployment can restart that single instance. Do not deploy casually while prospects may be testing.

## Pre-deploy gate
All must be true:
- [ ] `main` CI green.
- [ ] CodeQL green.
- [ ] npm production dependency audit green.
- [ ] No known active SEV-1/SEV-2 incident.
- [ ] No customer/prospect test call is known to be in progress.
- [ ] `/health` is healthy before change.
- [ ] Active voice-call count is zero immediately before deployment.
- [ ] Current production deployment ID/version is recorded.
- [ ] Current persistent-state backup/snapshot procedure is ready.
- [ ] Rollback target is identified.

## Deployment window
Prefer a controlled low-risk window when:
- prospect outreach is not actively directing people to demos,
- there is no known customer acceptance test,
- no production configuration changes are being made simultaneously.

Do not combine this release with:
- Twilio credential rotation
- OpenAI credential changes
- phone-number/trunk routing changes
- transfer-mode changes
- billing activation
- CRM credential changes
- Postgres migration

One change class at a time.

## Deployment procedure
1. Confirm current `main` SHA.
2. Confirm active calls = 0.
3. Record current Render deployment ID.
4. Trigger only the intended Render deployment from `main`.
5. Watch build gate; abort if syntax/tests fail.
6. Wait for service health.
7. Verify `/health`.
8. Verify authenticated `/ready`.
9. Verify the new authenticated `/api/v1/ops/voice-health` endpoint.
10. Verify the new authenticated `/api/v1/ops/customer-health?tenant=...` endpoint using a demo tenant.
11. Open the private Ops Health dashboard with admin authentication.
12. Confirm existing public demo routes are unchanged.
13. Do not run a multi-call load test against public demo numbers.

## Minimal live acceptance
Only with explicit approval:
- one controlled internal call to a demo route,
- verify prompt greeting,
- ordinary intake,
- lead persistence,
- optional human transfer if specifically approved for the acceptance call,
- confirm the operational milestone record appears.

A deployment can be considered technically healthy without generating public-demo test traffic if health/readiness endpoints and existing provider state are clean; live call acceptance is a separate confidence step.

## Rollback triggers
Rollback promptly if any of these appear after deployment:
- calls fail acceptance
- greeting/first audio regression
- unknown-route behavior changes
- lead persistence failure
- transfer path regression
- state-file corruption/error
- repeated restart loop
- authenticated readiness fails unexpectedly
- private dashboard/health instrumentation causes material application errors

Do not forward-fix a customer-impacting regression while public calls are affected if a known-good rollback is safer.

## Post-deploy observation
For the first observation window:
- monitor acceptance failures
- greeting first-audio/fallback
- Realtime/sideband errors
- lead persistence
- CRM sync
- transfer request/initiation/failure
- restarts and resource usage

Do not publish an uptime/SLA or concurrency claim from this initial data.

## Closeout
Record:
- deployed SHA
- Render deployment ID
- deploy time
- pre/post health state
- any acceptance evidence
- any anomaly
- rollback availability
