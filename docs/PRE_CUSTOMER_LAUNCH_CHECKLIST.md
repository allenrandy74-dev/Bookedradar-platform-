# BookedRadar Pre-Customer Launch Checklist

Updated: 2026-09-24

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
- [x] Founding Partner public offer documented at $497/month with setup fee waived and usage/scope guardrails
- [x] LLC formation finalized

## Remaining product/customer-experience gates
- [ ] Publish/attach Quick Start to a polished customer-facing onboarding entry point
- [ ] Wire live Quick Start submission event automatically into the protected provisioning preparation workflow
- [ ] Add customer-facing plain-language setup progress/status view
- [ ] Final controlled current-production voice intake acceptance call
- [ ] Final controlled transfer acceptance call: SMS summary -> 10-second hold -> REFER -> receiving-phone behavior
- [ ] Confirm handset delivery/content of the transfer companion SMS during the controlled transfer call
- [ ] Complete final external failure/retry drills that are safe to perform without customer traffic
- [ ] Freeze/tag first customer-ready release after voice/transfer acceptance passes
- [ ] Finalize service agreement/privacy/terms review for commercial launch
- [ ] Finish prospect-specific presentations and outreach drafts

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
intentionally disabled in the app. No test call or handset SMS delivery is marked
complete by this closeout.

Deployment verification: commit `0dea5f4` is live on Render; `/health` returned 200, billingMode=test, voiceEnabled=true, and no application error logs were returned for the deployment window. All 133 tests passed before deployment. Wix Quick Start schema update succeeded; this does not verify the form is attached to a public page.

- [x] Encrypted backup helper covers all five state files; synthetic isolated restore, wrong-key rejection and overwrite protection verified.
- [ ] Provision protected offsite destination/key recovery and demonstrate a consistent production-data restore (no live restore performed).
