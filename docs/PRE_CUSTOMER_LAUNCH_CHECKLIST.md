# BookedRadar Pre-Customer Launch Checklist

Updated: 2026-09-23

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
- [ ] Business mailing address finalized
- [x] LLC finalized
- [ ] EIN obtained
- [ ] Business bank account opened
- [ ] Billing/payment processor connected to business bank
- [ ] Tax/accounting workflow established
- [ ] Insurance needs reviewed for commercial operation

## Activation gate
Do not enable customer traffic until the customer's own tenant passes applicable readiness, synthetic acceptance, customer acceptance, escalation/rollback, and integration checks.
