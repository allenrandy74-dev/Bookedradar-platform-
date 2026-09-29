# BookedRadar Private Synthetic Voice Testing

## Purpose
Exercise the live carrier/voice path without using public prospect demo numbers.

The harness is intentionally fail-closed and is **not** a substitute for a dedicated private test environment.

## Hard safety rules
- Public prospect demo numbers must be supplied as forbidden numbers and the harness refuses them.
- An empty or malformed forbidden-number list is rejected, including in dry-run.
- Public prospect demo numbers are also forbidden as the test caller ID.
- Every target must use a tenant ID beginning with `synthetic-`.
- The caller ID cannot equal a target.
- Duplicate targets are rejected.
- At most 10 call-creation requests per run; configurable limits must be integers from 1 to 10. This is not a measurement of simultaneous connected calls.
- Each request has a provider-enforced 60-second connected-call limit and a 15-second answer timeout.
- The harness defaults to dry-run.
- Real calls require **both**:
  - `PRIVATE_SYNTHETIC_VOICE_ARMED=true`
  - `PRIVATE_SYNTHETIC_VOICE_DRY_RUN=false`
- No test numbers should be published or used in sales materials.

## Required future infrastructure
Before any real synthetic run:
1. Provision unpublished test phone number(s) approved for internal use.
2. Route them to dedicated `synthetic-*` tenant configurations.
3. Prefer an isolated/non-customer environment.
4. Configure a private caller ID that is not one of the prospect demo numbers.
5. Set the current public demo numbers in `PRIVATE_SYNTHETIC_FORBIDDEN_NUMBERS`.
6. Run a dry-run and inspect the plan.
7. Arm only for the controlled test window.
8. Disarm immediately after the run.

## September 29 preflight: no-interference requirement

The current infrastructure inventory contains only the two-instance production
Render service. A new telephone number routed through that service and its
OpenAI project would still consume shared production capacity. Do not run a load
test there to satisfy the requirement of no interference with prospect demos.

The user approved a combined $25 cap for dedicated private Twilio numbers and
Twilio/OpenAI test charges, followed by release of temporary numbers. That approval
does not itself provision or authorize additional paid Render services.

The proposed isolated test environment is:

- A disposable Render service with two instances matching production compute.
- A separate disposable PostgreSQL 18 database; no production data or database URL.
- A separate OpenAI project, webhook and API credential, with verified account-level
  quota headroom. Project separation alone does not establish independent quotas.
- A dedicated Twilio test trunk, five unpublished destination numbers for the five
  crafts, and a separate unpublished caller number. Verify account call-creation
  and concurrent-call limits before any burst; leave the public trunk untouched.
- Synthetic-only tenant configuration, with SMS, email, CRM, billing, transfers,
  and dispatch disabled; do not inherit production destination credentials.

Before purchasing anything, obtain approval for temporary Render compute/database
charges within the same aggregate $25 cap and verify current provider prices.
Reserve number provisioning costs, both Twilio call legs, OpenAI usage, taxes and
a contingency before determining the call allowance. A project budget notification
is not a hard spending stop. The 60-second call limit is not a dollar budget limit.

Start with one private call. Verify routing, first audio, caller transcription,
session closure and corresponding call records. Then test stages of two and five
overlapping calls only if the earlier stage is clean and sufficient budget remains.
Record actual connected intervals, not API submission overlap or queued status.
Any unknown creation result must be reconciled against provider call records before
retrying; an HTTP timeout does not prove that a call was not created.

Stop escalation on a route mismatch, absent audio, session/provider error, uncertain
spend, unexpected external action or production degradation. Reconcile final usage,
release temporary numbers, remove the disposable environment and revoke its
dedicated credentials. Report the highest clean observed concurrency as a tested
lower bound, not a ceiling, unless a higher failing stage was safely measured.

## Environment
Example only — do not commit real phone numbers or secrets:

```
PRIVATE_SYNTHETIC_VOICE_TARGETS=[
  {
    "name":"Private HVAC",
    "tenantId":"synthetic-hvac",
    "to":"+1XXXXXXXXXX",
    "scenario":"My air conditioner stopped cooling and the house is getting hot."
  }
]

PRIVATE_SYNTHETIC_FORBIDDEN_NUMBERS=["+1PUBLICDEMO1","+1PUBLICDEMO2"]
PRIVATE_SYNTHETIC_CALLER_ID=+1XXXXXXXXXX
PRIVATE_SYNTHETIC_VOICE_ARMED=false
PRIVATE_SYNTHETIC_VOICE_DRY_RUN=true
```

## How a synthetic call behaves
The internal Twilio caller:
1. calls the private target
2. waits briefly for the BookedRadar greeting
3. speaks the configured scenario
4. remains connected briefly so BookedRadar can respond
5. hangs up

This first version is designed to verify:
- carrier/SIP reachability
- correct private tenant route
- call acceptance
- first assistant audio
- caller speech/transcription path
- Realtime/session stability

It does not pretend to verify a complete multi-turn lead intake or transfer. Those require either a more advanced synthetic caller or a controlled human acceptance call.

## Running
Dry-run is the default:

```
npm run synthetic:voice
```

A real run must be explicitly armed through the environment and should only occur after the private targets have been reviewed.

## Success criteria
For every private synthetic target:
- Twilio accepts the outbound test call
- BookedRadar records the expected `synthetic-*` tenant
- first audio is observed
- no route rejection occurs
- no Realtime or sideband error is recorded
- operations health remains free of critical defect signals after the run

## Public demo protection
The current prospect demo numbers belong in the forbidden-number configuration whenever the harness is used. A test plan containing one of them must fail before any provider request is made.
