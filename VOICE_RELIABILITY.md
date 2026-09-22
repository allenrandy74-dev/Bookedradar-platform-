## Current production disposition — 2026-09-22 follow-up

The owner test reached a failed Twilio SIP relay leg (last SIP response 500),
with zero HTTP requests to the screening webhook. Configuration presence was
not evidence that SIP transport worked. WARM_TRANSFER_ENABLED is therefore
false until that transport is independently verified. The existing tel REFER
path is armed; no new phone numbers or inbound route changes were made.

The shared transfer controller logs requested/preflight/fallback_refer/referred,
bounds preparation and provider control, and treats a REFER HTTP success only
as acceptance. If screening is enabled later, it waits up to eight seconds for
signed relay entry, then revokes the pending entry before invoking tel REFER.
Late entry cannot start a duplicate outbound dial. Provider failures return
control to the assistant and log transfer.failed; no software can guarantee
completion when the provider itself rejects call control.

Health revision 2026-09-22.2 includes transferFallbackReady and transferMode.
Startup transfer.preflight identifies the configured route without caller data.
No-answer lifecycle events use transfer.no_answer.

# Voice reliability release — 2026-09-22

Existing inbound PSTN -> secure Elastic SIP trunk -> OpenAI SIP routing is preserved.
No phone number, trunk settings, origination URI, or OpenAI project settings change.

## Greeting

A four-second watchdog begins immediately after acceptance, including a stalled
sideband handshake. The server explicitly requests the exact tenant greeting.
Only output_audio_buffer.started proves SIP playback; transcripts do not count.
There is one retry, canceling active generation first, followed by fallback.
Server VAD: threshold 0.35, prefix 300 ms, silence 450 ms. Automatic responses and
interruptions turn on when opening audio starts. The subsequent idle timeout is
10 seconds, giving callers time to answer the final closing invitation.

With a configured screening relay, greeting failure goes to independent Twilio
speech. Until activation, it uses the proven human PSTN transfer. If call-control
also fails, the session is ended; audible fallback cannot be guaranteed when both
providers' control paths are unavailable.

## Screening

A dedicated Programmable Voice SIP domain receives transfers without moving the
existing phone number. REFER reaches this application, not the human directly.
A short-lived opaque SIP address identifies persisted tenant/lead context.
The relay answers with a hold announcement, then uses Dial/Number screening,
US ringing and answerOnBridge. Answering immediately matters because Elastic SIP
REFER does not support early media.

The recipient hears business, caller name, service, urgency, timing and BookedRadar
identification. Only 1 accepts. Wrong/empty input hangs up the recipient leg.
The caller receives a saved-lead fallback on failure. Saving precedes REFER and
does not wait for an external CRM request.

Twilio signatures, account matching, action-specific HMACs, expiry and CallSid
binding protect callbacks. Targets come only from server configuration. Updates
serialize per transfer. Duplicate entry requests return identical TwiML. Logs
omit phone numbers, caller summaries, tokens and SIP target URIs.

Events: transfer.requested, dialing, ringing, answered, accepted, bridged,
rejected, no-answer, failed, fallback. The bridged event is retrospective:
Twilio's DialBridged callback confirms it when the dial attempt ends. Press 1
alone never counts as confirmed bridging.

## Activation required

Screening stays off until its infrastructure is configured:

1. Create a dedicated secure Programmable Voice SIP domain, restricted to the
   documented Twilio trunk source IP ranges. Never use a world-open ACL.
2. Set its Voice URL (POST) to
   https://bookedradar-platform.onrender.com/voice/transfer/entry.
3. Merge these Render settings without replacing any existing variables:
   WARM_TRANSFER_SIP_DOMAIN, VOICE_PUBLIC_BASE_URL, TWILIO_ACCOUNT_SID,
   TWILIO_AUTH_TOKEN, TWILIO_VOICE_CALLER_ID, WARM_TRANSFER_ENABLED=true.
4. Caller ID must be an existing Twilio-owned or verified E.164 number.
   Preserve HUMAN_TRANSFER_NUMBER. No new number is required by this design.
5. Verify /health reports screenedTransferReady=true before owner test calls.

Until activation, screenedTransferReady=false and the proven legacy REFER remains.
The release does not claim warm handoff is live before these steps are completed.

## Verification

Run npm run check and npm test. The test command uses the intended test directory;
misplaced duplicate root tests are excluded. Tests cover greeting playback,
retry, silence, stalled handshake, cleanup, recipient decisions, no answer,
forged and cross-call callbacks, duplicate requests and truthful fallback wording.
Also test an isolated copy after the production Docker preload changes its files.

No live test calls during deployment. After activation the owner runs five calls:
normal greeting, short hello, accepted handoff, rejected handoff, unanswered
handoff. Check both parties' audio and logs before the 20-call reliability test.
