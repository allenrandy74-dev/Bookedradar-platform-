# BookedRadar Platform v1.5

This version supersedes v0.1.

## Architecture

```text
Caller
  ↓
Business phone number / SIP trunk
  ↓
OpenAI Realtime SIP endpoint
  ↕ live voice audio
OpenAI Realtime session
  ↕ sideband events + tools
BookedRadar backend
  ├─ durable lead log
  ├─ Wix CRM contact creation (when Wix API credentials are configured)
  └─ human call transfer
```

The direct-SIP design keeps call media off the BookedRadar application server. The backend handles verified webhooks, session configuration, lead capture, call transfer, and CRM integration.

## Current pilot capabilities

- Natural inbound AI phone conversation.
- Caller interruption/turn-taking is handled by the Realtime voice session rather than a custom audio relay.
- Captures name, callback number, service area/address, service need, urgency, preferred time, and useful notes.
- Never promises a time until a customer's real calendar/dispatch source is connected.
- Safety guardrails for gas/fire/electrical/CO/flooding/life-safety situations.
- Human escalation for caller request, complaints, payment/legal issues, unusual/high-value jobs, and ambiguous safety-sensitive cases.
- Persists every captured lead to JSONL before attempting CRM sync.
- Creates a Wix CRM contact when Wix server credentials are configured.
- Creates an ACTION_NEEDED Wix follow-up task linked to the new contact, due shortly after capture.
- Prevents repeated `capture_lead` calls during one live call from creating duplicate Wix contacts/tasks.
- Transfers an active SIP call to a configured human number.
- Verifies OpenAI webhook signatures and suppresses duplicate webhook deliveries in-process.
- Does not enable call recording.

## Requirements

- Node.js 20+
- OpenAI API project with Realtime access
- Public HTTPS deployment for this backend
- SIP trunking provider and phone number (Twilio is one supported example)
- OpenAI project webhook signing secret
- Optional Wix API key with the permission required to create CRM contacts
- A real human transfer number before escalation is enabled

## Install

```bash
cp .env.example .env
npm install
npm test
npm run check
npm start
```

## OpenAI setup

1. Create/use the OpenAI API project for BookedRadar.
2. Add a project webhook that points to:
   `https://YOUR-BACKEND/openai/webhook`
3. Subscribe it to the incoming Realtime call event.
4. Put the webhook signing secret in `OPENAI_WEBHOOK_SECRET`.
5. Put the project API key in `OPENAI_API_KEY`.
6. Note the OpenAI project ID (`proj_...`) for the SIP route.

Never put API keys or webhook secrets in source code or a browser.

## SIP provider setup

Purchase or use a phone number with a SIP-trunking provider.

Route the trunk to:

```text
sip:YOUR_OPENAI_PROJECT_ID@sip.api.openai.com;transport=tls
```

Then associate the inbound phone number with that trunk according to the provider's instructions.

## Human transfer

Set:

```text
HUMAN_TRANSFER_NUMBER=+1...
```

The AI uses the transfer tool only when escalation is appropriate. The backend issues the active-call SIP REFER.

## Wix CRM

This package includes a Wix Contacts adapter. It creates contacts at the BookedRadar site when these are configured:

```text
WIX_API_KEY=...
WIX_SITE_ID=dc96494e-5565-41be-8513-deeeedcf59d7
```

If Wix credentials are missing, lead capture still succeeds locally and reports that CRM sync was skipped.

Voice leads now create a linked Wix CRM follow-up task. A dedicated sales-pipeline card can be added later if we want phone leads represented in the sales pipeline as well as Tasks.

## Scheduling

v0.3 intentionally does not invent appointment availability. Until each pilot customer's live schedule/dispatch platform is connected, it captures a preferred appointment window and says the team will confirm it.

The scheduling adapter is customer-specific because an HVAC company may use ServiceTitan, Housecall Pro, Jobber, Google Calendar, or another dispatch system.

## Data / privacy

- No call recording is enabled by this code.
- Transcripts may appear in backend application logs if transcription events are emitted by the session. Treat logs as customer data and set an appropriate retention policy.
- Do not collect card numbers, passwords, Social Security numbers, or unrelated sensitive data.
- Before recording calls in any future version, implement appropriate disclosure/consent rules for the jurisdictions involved.

## Test milestone

The first real milestone is:

1. deploy backend,
2. configure OpenAI webhook,
3. configure SIP trunk/number,
4. call the number,
5. verify lead appears in `data/leads.jsonl`,
6. verify human transfer,
7. add Wix credential and verify CRM contact creation.

Only after those pass should a real customer's primary business number be routed through it.

## v0.3 hardening
- Persistent webhook idempotency state.
- Returning callers matched against Wix CRM by phone.
- Retry/backoff + timeouts for transient Wix failures.
- Transcript logging off by default.
- Masked phone numbers in operational logs.
- Docker deployment packaging.


## Unified BookedRadar recovery engine

v1.0 adds the non-voice services to the same backend:

- missed-call recovery
- web-lead response
- after-hours / overflow handling
- estimate follow-up
- cancellation recovery
- dormant-customer reactivation
- consent / suppression handling
- recovery action queue
- recovered-opportunity tracking
- explicit confirmed-revenue tracking
- RadarProof metrics API
- tenant-specific configuration

API endpoints:
- `POST /api/v1/events`
- `GET /api/v1/actions/due`
- `POST /api/v1/actions/:id/complete`
- `POST /api/v1/opportunities/:id/recovered`
- `POST /api/v1/opportunities/:id/revenue`
- `POST /api/v1/contacts/:key/opt-out`
- `GET /api/v1/radarproof`

See `SERVICES.md`, `CUSTOMER_ONBOARDING.md`, and `ARCHITECTURE.md`.


## v1.1 production hardening

- Source-event idempotency prevents duplicate webhook deliveries from creating duplicate opportunities/actions.
- Action claiming/leases prevent two workers from sending the same recovery action.
- Contact keys are namespaced per customer tenant.
- Revenue confirmation refuses unknown/cross-tenant opportunities.
- Dispatcher framework added for executing due work.
- Twilio SMS adapter added for accounts that provision Twilio credentials.
- Email webhook adapter added for customer-authorized email providers.
- Confirm-only booking adapter formalizes the safe default before a calendar/dispatch integration is live.
- RadarProof live dashboard shell added at `public/radarproof-dashboard.html`.


## v1.2 security and deployability

- Recovery/web/estimate/cancellation/reactivation services can run with `VOICE_ENABLED=false`.
- Voice credentials are required only when the phone operator is enabled.
- Ingestion requires `BOOKEDRADAR_INGEST_TOKEN`.
- Mutating/admin endpoints require `BOOKEDRADAR_ADMIN_TOKEN`.
- RadarProof is private by default; set `RADARPROOF_PUBLIC=true` only for an intentionally public proof view.
- Dispatcher executes configured channels and leaves unconfigured channels pending rather than pretending they were delivered.
- Wix human-task adapter creates/reuses CRM contacts by email/phone and creates a linked follow-up task.
- Twilio SMS is optional and activates only after real account credentials/from-number are configured.
- Email uses an authorized provider webhook, avoiding hardcoded mailbox credentials.
- Dashboard assets are served under `/dashboard`.


## v1.3 multi-customer architecture

- Tenant registry loads customer configurations from `config/tenants/*.json`.
- API calls select a tenant with `x-bookedradar-tenant` (or `?tenant=` for RadarProof).
- Contacts, opportunities, action queues, CRM writes, and RadarProof are tenant-isolated.
- Voice calls resolve the customer by the number dialed (SIP `Diversion`, then `To`).
- Unknown inbound numbers are rejected rather than accidentally answered under the wrong customer's identity.
- Human transfer uses the selected customer's escalation number.
- Phone-model/voice settings can be tenant-specific.
- Per-tenant credential prefixes let each customer use separate Twilio/Wix/email credentials.
- Voice capture creates/reuses a CRM contact but leaves follow-up task timing to the unified recovery engine, eliminating duplicate task creation.
- Recovery event idempotency uses tenant + call ID for AI phone leads.


## v1.4 deployment and validation

- Railway/Docker deployment configuration.
- OpenAPI 3.1 API contract.
- Production self-check command.
- File-state backup command for pilot deployments.
- Deterministic randomized simulator covering every recovery service.
- Security baseline and operations runbook.
- CI workflow for syntax/tests/simulation.
- Deployment handoff documents for Railway.


## v1.5 autonomous operations
- Optional automatic dispatch worker via `DISPATCH_INTERVAL_SECONDS`.
- Exponential retry backoff for provider failures.
- Failed-action admin view.
- Event/action retention pruning.
- `/ready` is now admin-protected.
- Self-check blocks unsafe `live_booking` configurations without an enabled calendar integration.


## v2.0 deployment candidate
- Auto-dispatch is enabled by default at a 30-second cadence and runs an immediate startup sweep.
- Repeated AI lead captures update the existing call opportunity instead of creating duplicate opportunities.
- Customer replies cancel pending automated SMS/email touches; terminal booking/won events cancel remaining recovery work.
- Booking/won events automatically mark RadarProof recovery attribution.
- Dedicated intake endpoints cover missed calls, web/after-hours leads, estimates, cancellations, dormant customers, replies, and STOP-family opt-outs.
- Live booking tools use a provider-neutral authenticated booking webhook; confirmation-only remains the default.
- AI operator context now includes local time, business hours, services, booking policy, pricing policy, and high-value escalation threshold.
- RadarProof private dashboard accepts the admin token in session storage.
- Render, Railway, Docker Compose, OpenAPI, config validation, secret generation, and post-deploy smoke-test assets are included.

- Runtime is pinned to Node.js 22+ with exact production dependency versions for deployment reproducibility.
