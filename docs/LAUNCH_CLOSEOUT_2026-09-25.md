# BookedRadar launch closeout — September 25, 2026

## Current decision

Core demo calls are owner-accepted with the known voicemail handoff limitation. Live Stripe setup and unpaid Checkout inspection are complete. Billing and recovery dispatch remain disarmed. This is not authorization to charge, send prospect outreach, sign agreements, enable optional channels, or route a new customer's calls.

## Completed and verified

- Randy accepted call testing around 12:31 PM America/Chicago; occasional transfer-to-voicemail behavior documented in the acceptance record, forwarding playbook and customer activation sheet.
- Four live products and eight monthly prices validated; Portal and webhook configured; controlled $397/month RadarRecover founding Checkout showed card/ACH and returned on cancellation, then was expired unpaid with no customer, subscription or payment intent.
- Production `/health` and protected `/ready` returned HTTP 200 during this closeout. One demo tenant, voice enabled, REFER fallback ready, 10-second transfer delay.
- Billing arm, global dispatch and one-time acceptance/CRM/email/SMS test switches verified false. The demo tenant remains shadow dispatch and confirm-only booking.
- Prior September 25 CRM cleanup and provider verification are documented in FIRST_CLIENT_LAUNCH_CHECKLIST.md. No new customer messages or calls sent during this closeout.
- Wix Quick Start updated to revision 4, all 15 fields retained: removed outdated $497 pilot wording, preserved CRM mappings, added estimate-software discovery prompt.
- Backup helper corrected to keep live/test billing names separate and include call history and web chat. Synthetic encrypted eight-store restore, wrong-key rejection, overwrite protection and mode-specific mapping tests pass. No production restore or consistent offsite backup is claimed.
- Sales research, outreach drafts, onboarding templates and service-order draft exist. Three approved introductions were sent from the company mailbox to First-Choice Plumbing, Ben’s Heating & Air, and Beaumont Plumbing on September 25 at approximately 2:24 PM America/Chicago. Gmail confirmed SENT; inbox delivery is not yet established. Reply/bounce/opt-out monitoring is enabled. No automatic reply or follow-up sending is enabled.
- Existing website source preserved and a static update built in `website/`: Quick Start receipt/next steps, restored audit form, clearly labeled chat demo, LLC/voicemail wording, sitemap and canonical internal links. JavaScript syntax, form structure, local links and sitemap XML checks pass. Live release and browser-origin acceptance remain pending Wix CLI authentication.

## Work requiring external completion

| Item | Next concrete step | Boundary |
| --- | --- | --- |
| Website release | Authenticate the Wix CLI for the existing site; publish and browser-test the prepared source update | Existing site only; keep Forms/CRM |
| Website chat | Install in static source and run website-origin capture/human-request acceptance after release | Demo must be clearly labeled; no customer notifications while dispatch is off |
| Quick Start preparation automation | Authenticate a verified Wix submission source and connect it to protected preparation, or use the documented manual operator step | Never expose admin tokens to the public form; submissions do not activate tenants |
| Offsite backup/key recovery | Choose an owner-accessible protected destination and separate key custody; take a consistent snapshot and demonstrate isolated production restore | Do not claim a live file copy is a consistent backup; do not restore over production |
| Alert receipt | Confirm notification recipient and verify one authorized alert delivery | Health/readiness HTTP checks do not prove owner receipt |
| Legal/commercial review | Qualified review of service order, terms/privacy and consent/retention obligations before signing/rollout | Operational drafts are not legal approval |
| Accounting and insurance | Establish bookkeeping/tax workflow and obtain the business-specific coverage review | Requires owner/professional decisions |
| First customer | Choose package, sign reviewed order, collect carrier/business rules, configure isolated tenant, test forwarding/rollback and enabled integrations | No fabricated customer configuration |
| Optional SMS/calendar/dispatch | Complete customer-specific consent, provider, STOP/HELP or calendar acceptance only when included and enabled | Keep unaccepted capabilities gated |
| Billing activation | Separate authorization to arm; first approved payment verifies settlement and paid-event handling | LIVE_ARMED remains false |
| Google indexing | Allow recrawl and check canonical consolidation later | Submission/redirect verification does not guarantee Google's timing |

## Manual onboarding preparation until automation is accepted

1. Read the existing Quick Start submission in Wix Forms and verify its business/contact details.
2. Use the protected `POST /api/v1/onboarding/prepare` endpoint with the submission. Keep the billing/admin credentials server-side.
3. Review the returned tenant draft and missing answers. A generated draft is not a deployed tenant or signed package selection.
4. Complete CUSTOMER_ACTIVATION_SHEET.md; obtain the selected package from the signed service order.
5. Run readiness and the customer's acceptance tests before routing or outbound activation.

## Backup operations

The helper now covers state, recovery state, leads, transfer state, separate test/live billing, call history and web chat. Missing files are reported, never silently marked complete. The `BACKUP_QUIESCED=yes` acknowledgement is only valid for stopped writers or a genuinely consistent snapshot. Keep encryption keys separate from archives, maintain owner recovery access, and restore only into a new isolated directory.

## Production update — September 25, approximately 2:29 PM America/Chicago

Render registry access recovered. Deployment `dep-darcmb7avr4c73e4rtcg` of commit `80a70198c501c4fc92f2cd254d982d9c5846d6d6` is live. The build passed all 206 tests. Startup validated all eight live package prices with `live_armed=false`, demo tenant readiness READY, confirmed REFER fallback ready, shadow dispatch with `dispatch_armed=false`, and confirm-only booking. The public health endpoint returned `ok=true`, voice enabled and `billingLiveArmed=false`. No payment or customer dispatch was performed.

The backup code fix is therefore deployed; offsite backup and production restore acceptance are still separate open items. Repository hygiene now excludes backup archives, standard restore directories and generated website output from source control and Docker builds. Existing tracked files are not removed by ignore rules. The operations instructions now distinguish read-only deploy verification from separately authorized notification tests.

Alert inspection: `buildTenantAdapters` maps both `human_task` and `human_alert` to the Wix task adapter. A successfully created CRM task is not proof of owner notification or independent outage monitoring. Confirm the intended alert channel, primary/backup recipients and actual receipt before closing the alert gate. No new alert or prospect messages were sent during this technical closeout.
