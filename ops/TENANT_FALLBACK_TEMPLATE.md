# Customer/Tenant Safe Fallback Template

Create one completed copy for every activated customer.

## Customer
- Tenant ID:
- Business name:
- Package:
- Coverage mode: after-hours / overflow / broader coverage
- Primary BookedRadar inbound route:
- Customer normal business number:
- Primary human escalation contact:
- Backup human escalation contact:
- Phone provider/carrier:
- CRM:
- Messaging provider:
- Scheduling provider/mode:

## Normal voice path
Document:
- customer number → forwarding/routing → BookedRadar number/SIP → OpenAI Realtime → BookedRadar control → lead persistence → CRM/recovery → human transfer

## Emergency fallback: BookedRadar application unavailable
- Carrier action:
- Destination:
- Who is authorized to change it:
- How to verify:
- How to reverse:

## Emergency fallback: AI/Reatime unavailable
- Carrier/route action:
- Destination:
- Customer-facing behavior:
- How to verify:
- How to reverse:

## Emergency fallback: transfer path unavailable
- Safe caller language:
- Alternative callback/voicemail workflow:
- Customer alert method:
- Escalation owner:

## CRM unavailable
- Durable lead source:
- Reconciliation owner:
- Duplicate-prevention rule:
- Recovery verification:

## SMS/email unavailable
- What remains active:
- What is suspended:
- Human alternative:

## Scheduling unavailable
- Revert to confirm-only:
- Approved language:
- Human confirmation owner:

## Disable switches
List only names/locations of controls, never credentials:
- customer-facing SMS
- live booking
- recovery dispatch
- web chat
- optional integrations
- experimental transfer mode

## Verification after fallback
- test caller reaches intended destination
- customer/business identity is correct
- no cross-tenant routing
- customer knows current degraded mode
- incident/support case updated

## Restore to normal service
- verify provider/application recovery
- run controlled acceptance test
- restore normal routing
- verify one complete path
- notify customer
- remove temporary emergency configuration
