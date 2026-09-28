# BookedRadar Private Synthetic Voice Testing

## Purpose
Exercise the live carrier/voice path without using public prospect demo numbers.

The harness is intentionally fail-closed and is **not** a substitute for a dedicated private test environment.

## Hard safety rules
- Public prospect demo numbers must be supplied as forbidden numbers and the harness refuses them.
- Every target must use a tenant ID beginning with `synthetic-`.
- The caller ID cannot equal a target.
- Duplicate targets are rejected.
- Maximum simultaneous targets defaults to 10.
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
