# BookedRadar Access and Secret Rotation Standard

## Principles
- Least privilege.
- Individual accounts instead of shared logins where supported.
- MFA wherever supported.
- Production and test credentials remain separate.
- Secrets never enter source control, public issues, support-case records, email drafts, or screenshots.

## Provider inventory
Review access for:
- GitHub
- Render
- OpenAI
- Twilio
- Wix
- Stripe
- Resend
- domain/DNS provider
- business email
- banking/payment systems where operationally relevant

## Quarterly access review
For each provider record:
- account owner
- active users/collaborators
- roles/permissions
- MFA status
- service accounts/API credentials
- last-needed justification
- remove stale access
- identify any single-person dependency

The repository may store the review template/status, but never secret values.

## Rotation triggers
Rotate credentials:
- immediately after suspected exposure
- after an employee/contractor with access leaves
- after an incident involving credential uncertainty
- when a provider reports compromise
- when moving from temporary/test credentials to production
- on the documented provider-specific schedule

## Rotation procedure
1. Identify all consumers of the credential.
2. Create/rotate credential without deleting the known-good path prematurely when provider supports overlap.
3. Update the secret store/environment.
4. Verify the dependent integration.
5. Revoke the old credential.
6. Record date, system, owner, and verification result — not the secret.
7. If rotation affects production voice, use a controlled window and verify public demo/customer paths immediately.

## Secret exposure response
If a secret appears in Git history, logs, a support case, screenshot, chat, or public issue:
- assume exposed
- rotate/revoke it
- remove the exposed copy where possible
- preserve incident evidence
- review downstream access
- do not rely on deleting the visible text as the remediation

## Emergency recovery
Recovery codes and break-glass credentials belong in a secure credential manager or equivalent protected location, not GitHub or Wix CMS.

At least quarterly, confirm the emergency-access method still works without displaying or exporting secrets unnecessarily.
