# Proof Pilot admission and carrier fallback

Enabled Proof Pilots reserve a durable call-history row under a per-tenant Postgres transaction lock before AI acceptance. This limits new admissions to the approved maximum of 25 calls or 14 days, whichever comes first. Lower tenant limits are supported. Calls already admitted may finish normally. Reservations survive instance restarts; failures after reservation consume a slot conservatively. Existing call rows inside the evaluation window count toward the cap. Replayed call IDs do not create slots or repeat provider decisions. A changed start time defines a new evaluation window and requires customer/operator review.

Pilot calls are blocked before AI acceptance when the pilot is scheduled, expired, capped, manually paused, unready, or its database check is unavailable. Non-pilot tenants retain their existing path. Pilot admission requires Postgres; local JSON cannot coordinate multiple app instances.

Carrier fallback is a separate prerequisite. OpenAI's rejection endpoint sends the chosen SIP response to the carrier; it does not itself redirect the caller to the customer's number. See [official OpenAI telephony documentation](https://developers.openai.com/api/docs/guides/voice-sip). Configure the carrier's rejected-call path and test that the agreed response reaches the customer's approved human/voicemail destination, without a forwarding loop or dropped call.

Only after that real test, record these fields under `commercial.proofPilot`:

- `carrierFallbackAccepted: true`
- `fallbackRejectStatusCode: 486` or `503`, matching the tested carrier rule
- `fallbackAcceptanceReference`: the actual test/evidence reference
- Existing scope approval, documented baseline, acceptance and start-time fields

These fields are acceptance records, not a carrier configuration command. Do not set them from a guessed destination or a mocked test. If missing, pilot readiness is blocked. Runtime denies AI admission even for a misconfigured enabled pilot, using 503 unless a permitted response code is configured. A carrier delivery failure remains possible until its fallback has been tested.

`manuallyPaused: true` stops new pilot admissions and appears in pilot status. Resolved manual pauses require an operator's configuration change. Current critical failed recovery actions, ambiguous provider outcomes awaiting reconciliation, and expired dispatch intents pause admission by default. New dispatch failures retain `failedAt`; legacy records fall back to completion/creation time. Critical failures without usable timing remain blockers. The API's scorecard continues to measure call-history records; admission failure reservations may consume the cap even if no AI session was established. Demo/synthetic activity needs its own tenant/window so it cannot use a customer's allowance.

## Acceptance before deployment

Run unit checks and the disposable Postgres integration test, including 50 concurrent attempts reserving exactly 25 slots, replays, tenant isolation, legacy calls, time expiry and pauses. Both app instances must run the reviewed gate release before any pilot is enabled; an older instance can bypass admission during a rolling deployment. Then use the private lab to verify provider rejection and the customer's carrier fallback under the exact planned SIP configuration. Prove a capped/expired call reaches the approved destination and that an already admitted call finishes. Do not change live forwarding, configure paid continuation or deploy this gate until those account/customer acceptance steps are approved.
