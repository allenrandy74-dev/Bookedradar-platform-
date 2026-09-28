# BookedRadar Private Support Case System

## System of record
BookedRadar support cases use the private Wix CMS collection:

- Collection ID: `BookedRadarSupportCases`
- Display name: `BookedRadar Support Cases`
- Site: existing published BookedRadar site
- Permissions: ADMIN required for read, insert, update, and remove

The collection is for operational/customer-support case metadata. It is not a caller transcript archive.

## Data allowed in a support case
Use only the minimum information needed to coordinate support:
- case title
- tenant/customer business identifier
- business name
- severity
- status
- source: customer, BookedRadar monitoring, provider
- concise impact statement
- accountable owner
- first-observed time
- next action
- next-update time
- safe internal evidence IDs
- workaround
- resolution
- redacted engineering-issue URL
- repeat-case reference
- last customer-update time
- close time

## Data prohibited from this collection
Do not store:
- API keys, passwords, tokens, or credentials
- full caller phone numbers unless separately approved and necessary
- caller names when an internal call ID is sufficient
- service addresses
- payment data
- Social Security numbers
- raw call transcripts
- call recordings
- customer secrets
- private authentication links
- unrestricted provider logs containing PII

Use safe call IDs/provider IDs to link back to protected operational evidence.

## Public GitHub rule
Customer support cases do not belong in public GitHub issues.

When a product defect requires an engineering issue:
- use redacted tenant/case identifiers
- describe expected vs actual behavior
- include safe technical evidence
- never copy customer/caller PII or private case notes

## Case status
Allowed operational statuses:
- new
- acknowledged
- investigating
- mitigated
- monitoring
- resolved
- closed

## Severity
- SEV-1: critical
- SEV-2: high
- SEV-3: normal
- REQUEST: service/configuration request

## Automation boundary
Automated monitoring may create or propose a support case only after:
- the signal maps to an approved severity rule
- the case payload passes support-case privacy validation
- duplicate/repeat detection is applied

Customer notification remains a separate action. Creating a case must never automatically send a customer message.

## Access review
At least quarterly:
- verify the Wix collection remains admin-only
- review who has site-admin access
- remove unnecessary access
- sample support cases for prohibited data
- confirm public GitHub issues remain redacted
