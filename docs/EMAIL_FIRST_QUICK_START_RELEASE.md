# Email-first Quick Start update — October 1, 2026

Quick Start defaults setup follow-up to email only. A setup-call number is shown
and required only after an explicit phone choice. Returning to email suppresses
that number from the submission. The separate caller-transfer destination stays
required and is not consent for setup or sales calls.

The Wix submission records `contact_preference` and a plain-language operator
instruction in `anything_else`. The preparation endpoint carries the preference
into the tenant draft, suppresses an email-only setup phone, and asks for a valid
direct setup number when a requested call lacks one. No submission activates a
tenant, phone route, billing or optional integration.

## Live schema

Existing site: `dc96494e-5565-41be-8513-deeeedcf59d7`.
Existing form: `1738b140-49de-4cde-b966-3dcd5f676cfc`.
Revision 5 verified by a fresh GET after update on October 1:

- All 15 prior fields preserved; one preference field added and placed in layout.
- Setup phone is optional at the Wix schema level.
- Caller escalation stays required.
- New optional preference accepts `email` or `phone`. It is optional for
  compatibility with the still-published older page.
- Existing mappings, automation, spam protection and submission access retained.

The public Quick Start HTML still requires the old setup phone until the prepared
static website package is released on Windows. Schema acceptance is not proof
of the new public experience or a live submission through the new page.

## Release and acceptance

1. Completed: PR #78 merged after CI and CodeQL passed. The backend onboarding
   mapper was deployed successfully and the signup page remained available.
2. Publish the refreshed Windows package to the existing Wix site. It includes
   the already-prepared homepage Start online links.
3. Verify email-only default, call selection, required setup phone only for calls,
   and the unchanged required escalation destination on the public page.
4. Run one controlled synthetic email-only setup and inspect only that submission:
   preference and do-not-call note saved, no contact phone from escalation,
   correct confirmation, and no activation/payment.
5. Confirm preference reaches the prepared tenant draft after backend release.

The earlier pilot signup provider test passed: a synthetic email-only contact
and task were persisted in Wix on October 1. Its task was labeled QA/do not
contact and completed. That test is evidence for pilot signup, not this Quick
Start change.

## Live provider acceptance — October 1

A clearly marked synthetic Quick Start test was submitted through the Wix Forms
API after backend release, omitting the setup phone. A later readback confirmed
that Wix finished processing it successfully.

- Saved preference was email-only; the setup phone was absent.
- The separate synthetic caller-transfer destination remained in the setup answers.
- The operator note preserved the email-only instruction and marked the test
  QA ONLY / DO NOT CONTACT.
- The synthetic CRM contact had no phone or additional phone numbers. The transfer
  destination was not repurposed as the setup contact number.
- No customer tenant or phone route was activated by this test.

This establishes provider persistence and contact mapping. Visitor-origin capture
through the unpublished new page and the production preparation endpoint still
need the public release and controlled follow-up.

Local checks: 370 tests passed; 15 Postgres integration tests skipped locally.
GitHub CI (including disposable Postgres), CodeQL and the website build passed.

## Rollback

Restore previous HTML/JS and preparation code through the existing release
workflow. Keep the added optional preference field so saved choices remain
visible. Restoring the phone-required flag would prevent email-only clients
from submitting; do not do that without also withdrawing the new page. Never
discard saved preferences or interpret escalation numbers as follow-up consent.

