# BookedRadar GitHub Governance Standard

## Purpose
Protect the production source branch so releases cannot bypass the same CI, security, and review gates BookedRadar relies on operationally.

## Required main-branch policy
Before first paying-customer production scale-up, configure GitHub so `main` requires:

- pull request before merge
- successful CI check
- successful CodeQL/security check where GitHub exposes it as a required status check
- branch must be up to date before merge when practical
- stale approvals dismissed after material changes if additional reviewers are later added
- force pushes disabled
- branch deletion disabled
- administrator bypass limited and used only for documented emergencies

## Current verified state
- CI workflow exists and runs on pull requests to `main`.
- CI performs:
  - reproducible `npm ci`
  - high-severity production dependency audit
  - syntax checks
  - full test suite
  - 200-scenario simulation
- CodeQL runs on pull requests to `main`.
- Dependabot is configured.
- GitHub repository rulesets API currently returns no rulesets.
- Classic branch-protection state cannot be read by the current GitHub integration, so it must be verified in GitHub settings by an authorized administrator.

## Emergency change rule
If a customer-impacting SEV-1 requires an emergency production change:
1. prefer rollback to a known-good version when safer
2. if an emergency patch is required, keep it minimal
3. run the available automated gates before deployment whenever technically possible
4. record the incident and emergency change
5. restore normal PR protection immediately
6. require a follow-up review/postmortem

Emergency access is not a routine shortcut.

## Repository visibility
The BookedRadar repository is currently public.

Before customer launch, explicitly decide whether public source is intentional. If the business intends BookedRadar to remain proprietary, make the repository private after checking:
- Render GitHub access remains authorized for a private repo
- GitHub Actions remain enabled
- required integrations/apps have access
- any public links/downloads that depend on the repo are identified
- historical binary/source artifacts are reviewed

Changing visibility does not erase information that was previously public. If historical secrets are ever discovered, rotate them.

## Historical artifact rule
Do not commit release ZIPs, backups, production state, credential exports, or database dumps to the source repository.

Release archives should be:
- generated from a known commit
- stored in an appropriate private artifact/release system when needed
- scanned before distribution
- never treated as a secret store

## Review evidence
Quarterly, record:
- repository visibility
- collaborators/installations
- main-branch protection status
- required checks
- recent bypass/emergency events
- unresolved security alerts
- historical artifacts requiring cleanup
