# Follow up acceptance and human review

Provider acceptance is not inbox or handset delivery. A recovery action may be completed only when its configured adapter returns a verified acceptance receipt. Delivery callbacks and customer/provider acceptance remain separate launch work.

## Adapter receipt contracts

- Resend: a successful response must include a nonblank string `id`. The adapter trims the receipt.
- Twilio SMS: a successful response must include a documented `SM` or `MM` SID and an outbound positive state: accepted, scheduled, queued, sending, sent or delivered. Missing, malformed, failed, canceled, undelivered and inbound statuses require review. The result preserves the exact provider status.
- Custom email webhook: a successful JSON response must contain `accepted: true` and a nonblank string `id`, for example `{"accepted":true,"id":"provider-reference"}`. Review the receiver against this contract before activating it. Existing bare HTTP 200/204 integrations no longer qualify as verified acceptance. This does not change provider accounts or activate sending.

Reference documentation: https://resend.com/docs/api-reference/emails/send-email and https://www.twilio.com/docs/messaging/api/message-resource.

Malformed success responses produce fixed acceptance_unverified errors marked for reconciliation. PostgreSQL dispatch fencing already retains ambiguous outcomes. The legacy dispatcher also holds receipt-validation errors rather than placing them back in its retry queue. This change does not retrofit durable fencing for every legacy provider failure; use the existing validated PostgreSQL dispatch path for customer sending. No provider acceptance or delivery is inferred for historical completed actions.

## Customer health and review

The authenticated customer-health endpoint includes totalUnresolvedActions, criticalUnresolvedActions, activeDispatches and oldestUnresolvedAt for the selected tenant. Reconciliation-required sends and dispatching records with expired/missing/malformed leases count as unresolved, regardless of their age. A dispatching record with a still-valid worker lease is shown separately as active work. Critical human-alert/task holds make health at_risk; other unresolved sends make it watch. Counts and a timestamp expose no recipient details. No claim is changed by this read.

Operators must verify the actual provider outcome and record authorized resolution through the established recovery reconciliation workflow. Do not clear holds, resend blindly or treat an action's completed status as customer delivery. These health signals cover recovery actions; booking and ops-notification review queues remain separate. Customer support owner/deadline assignment and delivery/bounce callbacks are not added by this change.

No schema migration, production activation, SMS registration change, credential change, customer message, real booking or charge is required or performed by this source change. Keep scope-specific acceptance and the deferred actual AI call test visible.
