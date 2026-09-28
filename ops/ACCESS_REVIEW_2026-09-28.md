# Access Review — 2026-09-28

This file records only non-secret access-review evidence safe for the public repository.

## Verified

### GitHub
- Repository: `allenrandy74-dev/Bookedradar-platform-`
- Repository visibility: public.
- Repository owner account `allenrandy74-dev` has admin permission.
- CI, Dependabot, production dependency audit, and CodeQL workflows are present in source.

### Render
- The connected account can access the BookedRadar Render workspace and production service.
- Production service remains configured with one instance and auto-deploy disabled.

### Wix
- The connected BookedRadar account has sufficient site-management permission to create and read the private support-case CMS collection.
- `BookedRadarSupportCases` was verified with ADMIN permissions for read, insert, update, and remove.

## Not verifiable through the current connected APIs

Do not mark these complete until checked in the provider's account/security console:

- full GitHub collaborator/team list
- GitHub MFA status and recovery methods
- Render workspace member/role list and MFA status
- Wix site/account collaborator list and MFA status
- OpenAI organization/project member roles and MFA status
- Twilio account users/roles and MFA status
- Stripe team roles and MFA status
- Resend team/API-key inventory
- domain/DNS account users and MFA status
- business-email administrators and recovery configuration

## Required console review

For each provider:
1. List active human users and service accounts.
2. Confirm least-privilege role.
3. Confirm MFA where supported.
4. Remove stale access.
5. Identify credentials/API keys no longer needed.
6. Confirm recovery/break-glass method.
7. Record only date, reviewer, provider, and outcome — never secret values.

## Review status

**Partial.** Connected-system permissions and operational controls were verified where the API exposes them. Provider membership and MFA status remain a manual/account-console verification item.
