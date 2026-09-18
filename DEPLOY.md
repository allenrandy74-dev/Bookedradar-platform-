# BookedRadar v2.0 Pilot Deployment Checklist

## Code / runtime
- [x] Node 22+ runtime specified.
- [x] Exact production dependency versions specified.
- [x] Syntax checks pass.
- [x] Automated tests pass.
- [x] Multi-tenant simulation passes.
- [x] One-replica persistent-state limitation documented.
- [x] Railway / Render / Docker deployment manifests included.

## Shared secrets — provision in the hosting platform
- [ ] `BOOKEDRADAR_INGEST_TOKEN`
- [ ] `BOOKEDRADAR_ADMIN_TOKEN`
- [ ] persistent `/app/data` volume attached

## AI phone — only when enabled
- [ ] `VOICE_ENABLED=true`
- [ ] OpenAI API project key configured
- [ ] OpenAI webhook signing secret configured
- [ ] Realtime incoming-call webhook points to `/openai/webhook`
- [ ] SIP-capable phone number/trunk routes to the OpenAI project
- [ ] customer's actual inbound number is present in the tenant config
- [ ] human transfer number is verified
- [ ] live test: routine caller
- [ ] live test: caller requests human
- [ ] live test: safety scenario
- [ ] recording remains disabled unless separately approved

## Recovery services
- [x] missed-call intake
- [x] web/after-hours lead intake
- [x] estimate follow-up intake
- [x] cancellation recovery intake
- [x] dormant-customer reactivation intake
- [x] customer reply handling
- [x] STOP-family opt-out suppression
- [x] automatic dispatcher
- [x] retry/backoff and failed-action visibility
- [x] reply/booking stops stale automation

## Customer integrations
For each tenant, enable only channels whose credentials have been provisioned.
- [ ] SMS provider credentials/number
- [ ] email provider webhook
- [ ] CRM credentials
- [ ] calendar/dispatch adapter, or leave `confirm_only`

## Verification
- [ ] `npm run self-check` passes in hosting environment
- [ ] `/health` passes
- [ ] `/ready` passes with admin token
- [ ] `npm run smoke` passes against deployed URL
- [ ] one controlled real opportunity flows through RadarProof
