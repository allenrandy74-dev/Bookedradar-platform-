# BookedRadar Private Support Mailbox Workflow

## Source of truth for early customer support
Until a dedicated support platform is selected, the BookedRadar business mailbox is the private support-case intake lane.

Do not copy customer PII, caller transcripts, private business information, credentials, or sensitive attachments into public GitHub issues.

## Gmail labels
Status:
- BookedRadar/Support/New
- BookedRadar/Support/Investigating
- BookedRadar/Support/Monitoring
- BookedRadar/Support/Resolved

Severity:
- BookedRadar/Support/SEV-1
- BookedRadar/Support/SEV-2
- BookedRadar/Support/SEV-3

Customer health:
- BookedRadar/Customer-Health/Watch
- BookedRadar/Customer-Health/At-Risk

## Handling a new support email
1. Apply **Support/New**.
2. Assess customer impact and assign SEV-1, SEV-2 or SEV-3 when it is an incident/defect.
3. Acknowledge the customer and apply **Support/Investigating** when work begins.
4. Use BookedRadar call/tenant/provider evidence before asking the customer to reproduce the problem.
5. If engineering work is needed, create a **redacted** GitHub issue with no customer PII and retain the private customer thread only in the support mailbox.
6. When a mitigation/fix is in place, apply **Support/Monitoring**.
7. After verification and customer communication, apply **Support/Resolved** and remove active status labels as appropriate.

## SEV-1 handling
For a SEV-1:
- follow the Incident Response Runbook
- do not rely solely on email polling
- preserve evidence
- protect lead durability and the human escape path
- freeze unrelated production changes
- communicate verified facts only

## Customer-health labels
**Watch** means the system is operating but a proactive review is warranted.
**At-Risk** means a material reliability/readiness issue could affect customer value or trust.

These labels are operational prompts, not sales labels and not hidden numerical scores.

## GitHub handoff rule
Public engineering issues may contain:
- redacted tenant identifier if safe
- internal event/call ID when it contains no PII
- expected vs actual behavior
- provider error code
- reproduction steps using synthetic data
- acceptance criteria

They must not contain:
- caller names, phone numbers, addresses or transcripts
- customer credentials/API keys
- private contract/pricing details not already public
- customer email thread contents
