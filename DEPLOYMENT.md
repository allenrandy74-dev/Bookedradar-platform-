# BookedRadar v2.0 Deployment Runbook

## Pilot architecture
Run one application replica with a persistent volume mounted at `/app/data`. The current JSON store is appropriate for founding-pilot traffic, but it is not a horizontally-scaled database. Migrate state to a shared transactional database before running multiple application replicas.

## Before deploy
1. `npm install`
2. `npm test`
3. `npm run check`
4. `npm run validate-config`
5. `npm run simulate`
6. `npm run generate-secrets` and put the values in the hosting provider's secret manager.

## Required platform secrets
- `BOOKEDRADAR_INGEST_TOKEN`
- `BOOKEDRADAR_ADMIN_TOKEN`
- persistent paths for `RECOVERY_STATE_FILE`, `STATE_FILE`, and `LEADS_FILE`
- `DISPATCH_INTERVAL_SECONDS=30`

## Per-customer channels
Each tenant has a `secretsPrefix`. Provider secrets use that prefix, e.g. `SMITH_HVAC_TWILIO_ACCOUNT_SID`.

Outbound channels only run when both tenant configuration and provider credentials are present. Unconfigured work stays pending; BookedRadar never marks it delivered.

## Voice
Keep `VOICE_ENABLED=false` until all of these exist:
- `OPENAI_API_KEY`
- `OPENAI_WEBHOOK_SECRET`
- a real SIP-capable phone number/trunk routed to the OpenAI Realtime project
- the tenant inbound number in `config/tenants/*.json`
- the tenant human escalation number

## Booking
Default is `confirm_only`. For `live_booking`, configure a customer calendar/dispatch webhook plus `<PREFIX>_BOOKING_WEBHOOK_URL` and optional `<PREFIX>_BOOKING_WEBHOOK_TOKEN`.

The webhook contract is:
- `{ "action": "find_availability", "request": {...} }`
- `{ "action": "create_booking", "request": {...} }`

A successful booking returns at minimum `{ "confirmed": true, "bookingId": "...", "slot": "..." }`.

## Inbound event endpoints
Use `Authorization: Bearer <BOOKEDRADAR_INGEST_TOKEN>` and `x-bookedradar-tenant`.
- `POST /api/v1/intake/missed-call`
- `POST /api/v1/intake/web-lead`
- `POST /api/v1/intake/estimate`
- `POST /api/v1/intake/cancellation`
- `POST /api/v1/intake/dormant`
- `POST /api/v1/intake/reply`

The reply endpoint recognizes exact STOP-family opt-out commands and cancels future automation for ordinary customer replies tied to an opportunity.

## After deploy
Set `BOOKEDRADAR_SMOKE_BASE_URL` and run `npm run smoke`. Then test one real call end-to-end before routing a customer's primary business number.
