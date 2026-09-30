# Private voice fallback candidate

These three protected Twilio Functions are a separate
Programmable Voice route for one unpublished test number. They do not edit the
existing production trunk or turn on the Render lab's voice flag.
Deployment and live acceptance are tracked separately; this source is not proof
of a successful AI connection. Keep both voice and call admission disabled
between approved test windows.

## Intended path

1. The unpublished private number's Voice webhook calls `/private-inbound`.
   Twilio Functions must mark both functions **Protected** so Twilio validates
   `X-Twilio-Signature`. A test caller, private number and approved human
   destination must be three distinct numbers. No public demo number is allowed
   in any of these settings.
2. During a configured window of at most 15 minutes, the inbound function
   checks the account, numbers, private OpenAI project ID and arm flag. Before
   any SIP attempt, it atomically creates one item keyed by the test run in a
   dedicated Twilio Sync Map. A duplicate key or Sync error returns busy.
   Admission closes two minutes before the window ends, leaving time for the
   SIP outcome callback. The admitted call makes one SIP `<Dial>` with a 15-second answer timeout
   and 60-second call limit. Every other request is rejected before SIP.
   The Function carries the validated private destination in `P-Called-Party-ID`,
   since the OpenAI project URI replaces the phone number in `To`. Deploy the
   matching `src/operator.js` parser update to the isolated app before testing:
   it reads that header only when neither `Diversion` nor `To` supplies a number.
   A successful fallback call, including cellphone call screening, is not proof
   that the AI accepted the SIP call or produced a greeting.
3. The protected `/private-outcome` action ends a completed or canceled call.
   Only a validated `busy`, `failed` or `no-answer` SIP attempt with the admitted
   parent CallSid can atomically claim the run's fallback key and make one bounded
   `<Dial><Number>` to the owner-approved human destination. A repeated callback
   or Sync error hangs up without a second dial. The callback must
   arrive while the same test window is active. A 503/486 result needs live
   mapping verification; local tests do not prove Twilio's real callback.
4. Configure the number-level **Primary Handler Fails** URL to the protected
   `/private-unavailable` Function. It returns a busy rejection with no SIP or
   human leg if Twilio cannot retrieve the primary webhook. It does not cover
   an outage affecting both Functions in the same Service, nor does it handle
   a SIP failure after valid primary TwiML; `/private-outcome` handles that.

This Programmable Voice design uses Twilio's `<Dial><Sip>` action callback;
it does **not** depend on Elastic SIP Trunking origination URI failover.
Twilio documents that a 486 response does not trigger that trunk failover.
The existing dedicated SIP trunk can remain unattached while this path is
tested. Do not attach the private number to both routes.

## Required Twilio Function environment

Set these in an isolated Twilio Functions Service, never in source control:

| Variable | Requirement |
| --- | --- |
| `PRIVATE_NUMBER` | One unpublished Twilio number in E.164. |
| `TEST_CALLER_NUMBER` | A distinct caller source in E.164; not Randy's fallback cellphone or a public demo number. |
| `HUMAN_FALLBACK_NUMBER` | Randy's owner-approved cellphone in E.164; keep the full value out of commits and logs. |
| `PRIVATE_PROJECT_ID` | The isolated OpenAI project's `proj_` ID; verify it against the private project in the provider console. Keep it out of source control. The Function constructs the SIP URI for `sip.api.openai.com` with TLS. |
| `SYNC_SERVICE_SID`, `SYNC_MAP_SID` | Dedicated pre-created Twilio Sync Service and Map SIDs, scoped to this private test. Twilio Function credentials must permit MapItem creation. Do not share a production map. |
| `TEST_RUN_ID` | A fresh `lab-` prefixed run identifier, unique for the one approved attempt. Never reuse after an ambiguous outcome. Admission and fallback keys persist until deliberately removed after reconciliation. |
| `LAB_TEST_ARMED` | `false` until the reviewed single-call window. |
| `TEST_WINDOW_START`, `TEST_WINDOW_END` | ISO UTC timestamps, positive interval no longer than 15 minutes. |

`ACCOUNT_SID` and `DOMAIN_NAME` are Twilio-provided Function context values.
Leave call recording off. Configure the number's Voice webhook only after
verifying all three protected Function URLs, exact account and no public demo
number. Set the number-level fallback webhook to `/private-unavailable` with
POST. An HTTP fallback URL is not proof of a SIP failure fallback.

## Release gates

- Verify remaining aggregate **$25** test allowance with Twilio number fees,
  the $1.04 observed Render lab accrual, zero private OpenAI project usage,
  both call legs, Sync usage, tax and contingency. The account's auto-recharge threshold
  is not a spending cap.
- Review the actual Function build, protected visibility, environment values,
  test number routing, signature validation and rollback. Keep Render voice,
  dispatch, billing and alerts off until their independent gates are met.
- Use a distinct test caller source. First prove the handler rejects unarmed,
  wrong-account and wrong-number requests. During one bounded live call, force
  the actual SIP failure response and observe the cellphone ring or voicemail,
  Twilio call records, cost and no loop. Do not mark carrier fallback accepted
  from unit tests or a SIP rejection alone.
- The Sync MapItem creation enforces one SIP admission for a given run ID,
  including concurrent requests. A second item ensures only one human fallback
  leg for that run, including a callback retry. An ambiguous first response
  consumes the run; never delete either item or choose a new run ID until
  reconciling Twilio calls and charges. It does not cap account-wide spend, number fees or unrelated
  traffic. Monitor the attempt, disarm immediately, and stop on uncertainty.
- Disarm and restore the number's prior voice configuration after the window.
  Do not activate customer routing from this private test.

References: [protected Functions](https://www.twilio.com/docs/serverless/functions-assets/visibility),
 [voice fallback webhooks](https://www.twilio.com/docs/voice/twilio-voice-failover-best-practices),
 [Sync MapItem creation](https://www.twilio.com/docs/sync/api/map-item-resource),
[`<Dial>` action](https://www.twilio.com/docs/voice/twiml/dial),
[`<Sip>` response parameters](https://www.twilio.com/docs/voice/twiml/sip),
and [Elastic SIP Trunking origination](https://www.twilio.com/docs/sip-trunking).
