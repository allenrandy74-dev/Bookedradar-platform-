# BookedRadar afternoon acceptance calls
Use only synthetic customer details. Record each call's local start time and outcome.
Use a separate calling phone when testing a transfer to Randy's phone.

## Call 1 — routine intake and close
Give first and last name, a callback number you control, a test service request, exact
service address, urgency and preferred timing. Provide a few details together to check
that the operator does not unnecessarily ask again. Ask for an appointment tomorrow.

Pass: prompt greeting; correct business identity; complete intake; callback confirmation;
appointment is only a request, not a confirmed calendar booking; natural close and a
pause for your response. Check the resulting CRM contact/task and notification content.

## Call 2 — transfer accepted
Provide enough details to identify the caller and request. Ask to speak with a person.
Have the receiving phone visible and accept the transferred call.

Pass: SMS arrives and contains the correct business/caller/request summary; hold
announcement and approximately 10-second delay; receiving phone rings; two-way audio;
no lost caller or misleading claim of a private spoken briefing.
Record when the SMS arrived and when the receiving phone rang. Provider acceptance of
an SMS alone is not a delivery pass. Do not include sensitive details in screenshots.

## Call 3 — transfer declined or unanswered
Use synthetic details, request a person, then decline or leave the receiving call
unanswered. Record exactly what the caller hears, including whether voicemail answers.

This is an observation/approval gate: the current fallback is a blind REFER transfer,
not a screened transfer. We must confirm the observed voicemail/no-answer behavior is
acceptable for the pilot and accurately describe it. A silent drop or an unhandled
caller blocks acceptance; do not assume the AI can recover a call after REFER.

## Call 4 — immediate human request
Ask for a person immediately after greeting, without giving a name first.
Pass: the approved escalation behavior occurs without inventing customer information
or trapping the caller in intake. Missing details remain missing in CRM/SMS.

## Return these results
| Call | Local start time | Greeting/intake | SMS received | Transfer outcome | Issue |
| --- | --- | --- | --- | --- | --- |
| Routine | | | N/A | N/A | |
| Accepted transfer | | | | | |
| Declined/unanswered | | | | | |
| Immediate human | | | | | |

After the calls, correlate production call IDs, CRM/task records, transfer events and
SMS delivery status. Remove only identified synthetic test CRM records. Freeze the
customer-ready release only after observed issues are resolved and Randy accepts the
behavior. Each new customer's own routing/configuration still needs acceptance.
