# Email first pilot signup release

## Customer experience

Homepage Start online links open the dedicated platform signup page. The customer
provides name, business and email, with email-only follow-up selected. Trade and
workflow details are optional. A phone number is required only when the customer
requests a call. The confirmation explains review, agreed scope and terms, and
acceptance before customer traffic. A direct email option remains available.

This is a pilot inquiry, not automatic tenant creation, a payment or activation.
The request keeps the existing capped Proof Pilot and paid-continuation controls.

## Operator handling

Email-only requests carry an explicit do-not-call instruction in the saved Wix
follow-up task. They do not populate the generic callback field, including when
an older client also supplies a phone. Do not use a public business number to
circumvent the requested channel. Phone-only legacy submissions remain supported.
Confirm the contact preference and scope in written follow-up; do not send an
unverified price or claim a customer case study.

## Release order

1. Review this branch against main and pass CI/security checks. This branch is
   based on main, not the private voice-lab branch.
2. Release the reviewed API, public/signup.html and public/pilot-signup.js together
   to the platform serving bookedradar-platform.onrender.com. Retain the accepted
   runtime configuration and verify both production instances. Do not enable
   voice, billing, messaging or provisioning as a side effect of this change.
3. Verify the public signup URL and script, mobile layout, channel switching,
   retained inputs on failure and the existing try.html#pilot redirect CTA.
4. Make one authorized synthetic production inquiry with controlled contact
   details, verifying the actual Wix contact and task and its email-only note.
   Read-only inspection and mocked tests do not establish provider acceptance.
5. Build and publish website/src to the existing Wix site using its established
   release workflow, after the new platform URL is confirmed live. Do not create
   another site or publish a homepage pointing to a missing signup page.
6. Only after verification, update campaign email links to the dedicated signup
   URL. Existing drafts currently point to the still-live try.html#pilot path.

The intended new URL is
https://bookedradar-platform.onrender.com/dashboard/signup.html.

## Verification at preparation

- Full main-branch unit suite: 364 passed, 15 database integration tests skipped
  without a disposable Postgres URL; no failures.
- Targeted normalization and Wix task tests prove the preference reaches the
  actual serialized CRM task payload using a mocked provider.
- Frontend behavior tests exercise default email-only, phone selection, duplicate
  messaging, failed submission and one in-flight request at a time.
- Website static build succeeds. Browser-rendered layout and live provider capture
  remain pending: the available browser runtime download returned invalid archives.

## Known scope boundaries

No automatic email receipt is promised or newly sent. Existing inquiry deduplication
can identify a previously submitted contact; the UI therefore asks the customer to
confirm status or change preference by email instead of claiming a changed choice
was persisted. No credentials or real prospect records are added to this branch.

## Rollback

Restore the prior website links first. Restore the prior public try page and API
release through the existing reviewed platform rollback procedure. Confirm old
phone/email inquiry handling remains available and previously saved CRM tasks are
retained. Do not remove existing customer contact records.
