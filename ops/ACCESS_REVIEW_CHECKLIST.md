# BookedRadar Quarterly Access Review

## Purpose
Confirm that every person, integration, token and provider permission still has a legitimate need and the minimum access required.

Run quarterly and after any staffing/contractor change or suspected credential exposure.

## Accounts to review
- GitHub
- Render
- OpenAI
- Twilio
- Wix
- Stripe
- Resend
- Google/Gmail
- domain/DNS provider
- business banking/payment providers
- any CRM, scheduling, support, analytics or monitoring provider added later

## Review checklist
For each system:
- [ ] List people/users with access.
- [ ] Remove access no longer required.
- [ ] Confirm MFA is enabled where supported.
- [ ] Confirm shared credentials are not being used when individual accounts are available.
- [ ] Confirm production access is limited to people who need it.
- [ ] Review API keys/tokens and their scopes.
- [ ] Remove unused or duplicate keys.
- [ ] Confirm test credentials are distinct from production.
- [ ] Confirm customer-specific credentials remain tenant-isolated.
- [ ] Confirm recovery codes / emergency access are stored securely.
- [ ] Record reviewer and review date.

## GitHub-specific
- [ ] Review repository collaborators/installations.
- [ ] Review GitHub App permissions.
- [ ] Review Actions workflows for unnecessary write permissions.
- [ ] Confirm no secrets exist in source, commits, issues or workflow logs.
- [ ] Review Dependabot / CodeQL findings.

## Production provider review
For Render, OpenAI, Twilio, Wix, Stripe and Resend:
- [ ] Verify production account identity.
- [ ] Verify current authorized administrators.
- [ ] Review recent security/account events when available.
- [ ] Verify webhook destinations are expected.
- [ ] Verify credentials map to the intended BookedRadar environment.
- [ ] Verify no stale test callback/webhook endpoints remain enabled.

## Evidence
Record only non-secret evidence:
- date
- reviewer
- systems reviewed
- removals/changes made
- open follow-up actions

Never copy secrets, recovery codes or full tokens into the review record.
