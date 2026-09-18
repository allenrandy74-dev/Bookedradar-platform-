# Railway Deployment Handoff

The repository is prepared for Railway with `Dockerfile` and `railway.json`.

Required shared environment variables:
- `PORT` (Railway may provide this automatically)
- `BOOKEDRADAR_INGEST_TOKEN`
- `BOOKEDRADAR_ADMIN_TOKEN`
- `TENANT_CONFIG_DIR=./config/tenants`
- `RECOVERY_STATE_FILE=./data/recovery-state.json`
- `STATE_FILE=./data/state.json`
- `LEADS_FILE=./data/leads.jsonl`
- `DISPATCH_INTERVAL_SECONDS=30`

If voice is enabled:
- `VOICE_ENABLED=true`
- `OPENAI_API_KEY`
- `OPENAI_WEBHOOK_SECRET`
- `OPENAI_REALTIME_MODEL=gpt-realtime-2.1`

Per-customer secrets use each tenant's `secretsPrefix`, for example:
- `SMITH_HVAC_TWILIO_ACCOUNT_SID`
- `SMITH_HVAC_TWILIO_AUTH_TOKEN`
- `SMITH_HVAC_TWILIO_SMS_FROM`
- `SMITH_HVAC_WIX_API_KEY`
- `SMITH_HVAC_WIX_SITE_ID`
- `SMITH_HVAC_EMAIL_WEBHOOK_URL`
- `SMITH_HVAC_EMAIL_WEBHOOK_TOKEN`

For a single-instance pilot, attach a Railway persistent volume to `/app/data`.
Before multi-instance production, replace JSON state with a transactional database.

For live booking, also configure `<PREFIX>_BOOKING_WEBHOOK_URL` and optional `<PREFIX>_BOOKING_WEBHOOK_TOKEN`; otherwise keep that tenant in `confirm_only`.
