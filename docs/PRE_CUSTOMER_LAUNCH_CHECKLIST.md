# BookedRadar Pre-Customer Launch Checklist

Updated: 2026-09-25

Current status: see `LAUNCH_CLOSEOUT_2026-09-25.md`. Owner accepted call testing September 25 with possible voicemail handoff documented. Historical evidence below does not imply that disabled optional channels are active.

## Completed before customer launch
- [x] Production voice platform deployed
- [x] Wix CRM permission smoke test passed and temporary records removed
- [x] CRM smoke-test mode disabled after verification
- [x] Tenant readiness engine added
- [x] Customer Quick Start form created in Wix Forms
- [x] Quick Start form synthetic submission/contact path verified and cleaned up
- [x] Quick Start answers translate into a tenant draft
- [x] Protected onboarding preparation endpoint added
- [x] Plain-language onboarding action model implemented: we handle it / customer action / optional follow-up
- [x] Production builds gated by syntax checks and automated tests
- [x] Customer onboarding standard documented
- [x] Customer FAQ documented
- [x] Founding-customer sales playbook documented
- [x] Resend sending domain fully verified (DKIM, SPF MX, SPF TXT, CNAME)
- [x] Production Resend email smoke test provider-accepted
- [x] Synthetic recovery E2E passed: email + Wix contact/task
- [x] Twilio A2P campaign approved
- [x] Twilio credential/API diagnostic passed: account, Messaging Service and sender-pool reads all HTTP 200
- [x] Twilio sending number confirmed present in the Messaging Service sender pool
- [x] Internal transfer SMS production smoke test provider-accepted
- [x] Approved transfer delay restored to 10 seconds
- [x] Temporary Twilio diagnostic and SMS smoke hooks disabled/removed after verification
- [x] Revenue Leak Audit synthetic submission -> Wix contact -> follow-up task verified and test records removed
- [x] Founding Partner package/pricing and usage/scope guardrails documented
- [x] LLC formation finalized

## Remaining product/customer-experience gates
- [ ] Publish/attach Quick Start to a polished customer-facing onboarding entry point
- [ ] Wire live Quick Start submission event automatically into the protected provisioning preparation workflow
- [ ] Add customer-facing plain-language setup progress/status view
- [x] Voice intake acceptance accepted by Randy September 25; no additional call was placed for this closeout.
- [x] Transfer experience accepted by Randy September 25 with unanswered/declined transfers sometimes reaching voicemail.
- [x] Randy previously confirmed receiving transfer text messages; no new carrier test was performed in this closeout.
- [ ] Complete final external failure/retry drills that are safe to perform without customer traffic
- [x] Production ACCEPTANCE_AUDIT_ON_STARTUP=false verified after the September 25 billing deployment.
- [ ] Freeze/tag first customer-ready release after current-build voice/transfer acceptance passes
- [ ] Finalize service agreement/privacy/terms review for commercial launch
- [x] Prospect-specific outreach drafts and sales materials prepared; sending still requires explicit authorization.

## Waiting on owner/business administration
- [x] Business mailing address finalized
- [x] LLC finalized
- [x] EIN obtained
- [x] Business bank account opened
- [x] Stripe account activated and connected to BookedRadar LLC Grasshopper checking
- [x] Stripe sandbox lifecycle, failed-payment recovery, portal and cancellation verified
- [ ] Production app billing enabled after commercial launch review
- [ ] Tax/accounting workflow established
- [ ] Insurance needs reviewed for commercial operation

## Activation gate
Do not enable customer traffic until the customer's own tenant passes applicable readiness, synthetic acceptance, customer acceptance, escalation/rollback, and integration checks.

## September 24 closeout
- [x] $497 pilot separated from separately quoted scheduling/dispatch in repository offer, FAQ, sales and onboarding documents
- [x] Scheduling discovery and quote-input worksheet prepared (SCHEDULING_SCOPE.md)
- [x] Commercial order worksheet prepared with unresolved decisions explicitly marked (PILOT_ORDER_WORKSHEET.md)
- [x] Onboarding drafts default to appointment requests; scheduling interest triggers separate review
- [x] Live-booking readiness requires separately approved scope/agreement plus a booking adapter
- [x] Afternoon acceptance-call instructions prepared (AFTERNOON_ACCEPTANCE_CALLS.md)
- [x] Pilot incident/rollback procedure prepared (PILOT_OPERATIONS_RUNBOOK.md)
- [x] Existing Wix Quick Start form updated with pilot appointment-request boundary and separate scheduling quote/agreement language (form revision 3; all 15 fields retained)
- [ ] Publish revised boundaries on the existing Wix offer/FAQ and verify the public onboarding entry point
- [ ] Verify live monitoring/alert receipt and protected backup/isolated production restore

Repository documentation is not proof that website copy or a Wix form was published.
The commercial worksheet is not a reviewed or signed contract. Live billing remains
intentionally disabled in the app.

- [x] Encrypted backup helper covers all five state files; synthetic isolated restore, wrong-key rejection and overwrite protection verified.
- [ ] Provision protected offsite destination/key recovery and demonstrate a consistent production-data restore (no live restore performed).

## September 25 re-verification

- [x] Current Render production deploy is live from `main` at commit `129abe67018f43a1662c3cac341e67bfe7fe7352`.
- [x] Current production image ran syntax checks and the automated suite: **198 tests passed, 0 failed**.
- [x] Demo tenant startup readiness remains **READY** with zero blockers and zero warnings.
- [x] Production startup reports CRM enabled/credentialed, Resend enabled/configured, and email/human-task/human-alert dispatch configured.
- [x] Recovery SMS remains disabled for the demo tenant.
- [x] Transfer companion startup reports configured with the exact **10,000 ms** delay.
- [x] Screened/warm transfer remains disabled; proven SIP REFER fallback reports ready.
- [x] Historical September 24 production transfer evidence shows provider-accepted transfer SMS, a 10,001 ms measured delay, REFER fallback, and a successful referred event.
- [x] Resend sending domain remains verified; September 22-25 account metrics showed **3 sent / 3 delivered / 0 failed / 0 bounced**.
- [x] Twilio A2P approval was independently re-confirmed from the September 23 carrier-registration approval notice.
- [x] Existing BookedRadar Wix site remains published on the custom domain with Wix Forms installed; the site is still Editorless.
- [x] Production billing remains intentionally fail-closed in test mode with `live_armed=false`; no billing activation was performed.
- [x] One-time metadata acceptance audit found stored call-history evidence for five prior calls, including spam screening, transcript history, lead summaries, and one knowledge-gap signal.
- [x] Owner acceptance is recorded separately above. Historical audit limitation: all five audited records reported `transferred=false`, and material greeting/VAD/half-duplex changes landed after the previously proven September 24 transfer call.
- [x] Randy accepted prior call tests September 25; keep future voice-path changes subject to a new regression call.

### Why the current-build acceptance gate is open

The September 24 transfer proof remains valid evidence that the SMS -> 10-second delay -> REFER architecture worked. It is not sufficient evidence for the current production image because the voice path subsequently changed to suspend VAD during the opening greeting, harden noise handling, protect normal assistant speech from ambient barge-in, and coordinate transfer-hold state with the output guard. Those changes are covered by automated tests, but the provider/handset boundary still requires one controlled human call on the deployed build.

