# BookedRadar Customer Phone Forwarding Playbook

Purpose: make the first customer's phone setup simple, reversible and testable. The customer keeps the existing business number unless a separate porting/routing plan is explicitly approved.

## Information to collect

Before giving forwarding instructions, confirm only:

1. Existing business phone number.
2. Phone provider / carrier.
3. Desired coverage mode:
   - after-hours,
   - overflow/no-answer,
   - busy-line overflow,
   - broader agreed coverage.
4. Whether the provider is managed through a mobile handset, desk phone, web portal, PBX/VoIP dashboard or carrier support.
5. BookedRadar destination number assigned to that tenant.

Do **not** ask the customer to send account passwords, PINs, recovery codes or full carrier credentials by email/chat.

## Customer-facing instruction template

### What we are changing

Your customers will continue calling **[EXISTING BUSINESS NUMBER]**.

We are configuring your phone provider to forward only **[AFTER-HOURS / NO-ANSWER / BUSY / AGREED COVERAGE]** calls to your BookedRadar line:

**[BOOKEDRADAR DESTINATION NUMBER]**

Your existing number remains your public number.

### Before turning it on

Please make sure:

- your normal business number can place and receive calls;
- the BookedRadar destination number has passed its tenant acceptance test;
- your human escalation number is correct;
- the BookedRadar greeting identifies your business correctly;
- you know how to disable forwarding again.

### Enable forwarding

Use the exact provider-specific steps BookedRadar gives you for **[CARRIER / PHONE SYSTEM]**.

Do not use a generic star code unless we have confirmed that code for the customer's actual provider and line type.

### Test 1 — normal customer call

1. Call the normal business number from a phone that is not part of the business phone system.
2. Allow the chosen forwarding condition to occur.
3. Confirm BookedRadar answers with the correct business identity.
4. Give a test service request.
5. Confirm name, callback number, service need, address, urgency and preferred timing are handled correctly.
6. End normally.
7. Confirm the expected CRM/recovery record appears.

### Test 2 — human escalation

1. Call the normal business number again.
2. Give enough test information to create context.
3. Say that you want to speak with someone.
4. Confirm the receiving person gets the expected companion summary.
5. Confirm the caller hears the hold message rather than silence.
6. Confirm the transfer reaches the approved receiving phone.
7. Decline/answer as desired and confirm the expected fallback behavior.

### Test 3 — forwarding off / rollback

1. Disable forwarding using the provider-specific reversal steps.
2. Call the normal business number again.
3. Confirm it follows the customer's original phone behavior.
4. Re-enable only after the customer is satisfied with the acceptance tests.

## Provider-specific instruction record

For every customer, save this completed block with the tenant activation record:

- **Provider / phone system:** 
- **Line type:** mobile / landline / hosted VoIP / PBX / other
- **Customer business number:** 
- **BookedRadar destination number:** 
- **Forwarding mode:** 
- **Exact enable steps:** 
- **Exact disable steps:** 
- **Ring/no-answer delay:** 
- **Provider source used to verify instructions:** 
- **Verified date:** 
- **Customer performed setup:** yes / no
- **Normal-call test passed:** yes / no
- **Human-transfer test passed:** yes / no
- **Rollback test passed:** yes / no
- **Customer acceptance date:** 

## Safety rules

- Never change forwarding on an unknown line/account.
- Never assume mobile-device instructions apply to a hosted business phone system.
- Never use the BookedRadar owner's personal transfer number as a customer's public forwarding destination.
- Never activate real customer forwarding before that tenant's identity, phone route, escalation, CRM/integration and required communication channels are ready.
- Keep a tested rollback path.
- A phone-forwarding change alone does not make a customer "live"; the customer-specific launch checklist and acceptance call still control activation.
