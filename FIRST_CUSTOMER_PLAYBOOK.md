# BookedRadar First Customer Playbook

## Objective

Move a qualified prospect from verbal interest to a safe live BookedRadar deployment without changing scope on the fly.

**Recommended first-market offer:** RadarRecover Founding Partner — $397/month, setup waived.

## Stage 1 — Qualify

Confirm:
- Home-service business with meaningful inbound demand.
- Missed calls, after-hours calls, web leads, stale estimates, cancellations or follow-up gaps are economically meaningful.
- Owner/manager is willing to define service area, services, hours and escalation rules.
- Existing phone routing can forward after-hours or overflow calls.
- Customer understands BookedRadar is a revenue-recovery operating layer, not simply an AI receptionist.

Avoid promising:
- live booking unless RadarSchedule is purchased and accepted;
- full dispatch unless RadarDispatch is separately scoped;
- unlimited usage;
- guaranteed revenue;
- customer-facing SMS before provider/A2P acceptance.

## Stage 2 — Quote and service order

1. Select package.
2. Fill the Customer Service Order.
3. Record:
   - monthly price;
   - setup fee/waiver;
   - coverage mode;
   - transcript choice;
   - messaging approvals;
   - scheduling authorization state;
   - integrations;
   - customer acceptance contact.
4. Obtain approval/signature.
5. Create the billing account only for the package on the signed order.
6. Verify Stripe Checkout displays the same package and price before payment.

## Stage 3 — Quick Start

Collect the minimum required:
- business name and trade;
- service area;
- services;
- normal business hours;
- human escalation contact;
- coverage mode.

Optional but useful:
- website;
- phone provider;
- CRM/system of record;
- urgent-call definition;
- unusual policies;
- reply-to email;
- desired gated capabilities included in the package.

Do not ask the customer to configure technical feature flags.

## Stage 4 — Generate tenant

1. Generate tenant ID and isolated secrets prefix.
2. Apply the signed service profile.
3. Store package entitlements separately from activated capabilities.
4. Normalize service area/hours/services.
5. Add safety and escalation rules.
6. Add approved inbound BookedRadar number/route.
7. Configure only the integrations the customer selected.
8. Keep every provider- or consent-dependent feature gated until accepted.

Run:

`npm run deployment:plan -- <tenant-id>`

Then:

`npm run onboarding:readiness`

Required state before customer acceptance:
- no core blockers;
- no active feature outside the package;
- no missing credential for an enabled adapter;
- confirm-only booking unless the customer has separately passed live-booking gates.

## Stage 5 — Phone forwarding

Give provider-specific instructions:
- number to forward to;
- mode: after-hours, no-answer/overflow, or agreed full coverage;
- how to enable;
- how to disable;
- how to reverse immediately if needed.

Do not request the customer's phone-provider password.

## Stage 6 — Integration acceptance

### CRM
Verify:
- contact create/reuse;
- linked task;
- duplicate prevention;
- correct tenant credentials.

### Email
Verify:
- sender identity;
- reply path;
- synthetic delivery.

### SMS — only when enabled
Verify:
- approved sender/campaign;
- delivery;
- STOP;
- HELP;
- suppression;
- tenant isolation.

### Web chat — only when enabled
Verify:
- approved origin;
- lead/opportunity creation;
- existing-opportunity update;
- human escalation.

### Live booking — only when separately enabled
Verify:
- real free/busy;
- duration rules;
- slot recheck;
- provider booking ID;
- no booking when slot becomes unavailable.

## Stage 7 — Customer acceptance call

Customer calls their normal business number through the actual forwarding configuration.

Test:
1. Business greeting.
2. Name.
3. Service need.
4. Exact address/city.
5. Urgency.
6. Preferred timing.
7. Callback confirmation.
8. Ask for human.
9. Verify receiving person gets expected context.
10. Verify transfer completes.
11. Verify CRM/task/approved notifications.
12. End normally.

When included/active, add:
- Spanish call;
- returning caller;
- Knowledge Gap question;
- transcript check;
- spam/solicitor test.

Any failed active feature returns to gated/off until fixed.

## Stage 8 — Go-live decision

Go live only when:
- service order matches tenant package;
- billing package matches signed package;
- tenant readiness is READY;
- enabled integrations passed;
- customer acceptance passed;
- owner knows how to disable forwarding if needed.

Record:
- go-live date/time;
- enabled coverage;
- customer approver;
- BookedRadar approver;
- package;
- active/gated capability snapshot.

## Stage 9 — First 72 hours

Review:
- every call outcome;
- transfer behavior;
- CRM writes;
- email/SMS delivery where enabled;
- knowledge gaps;
- duplicate events;
- unanswered/abandoned calls;
- recovery actions;
- customer feedback.

Do not make broad prompt/routing changes from one odd call unless safety demands it.

## Stage 10 — First 30 days

Provide customer review with:
- calls handled;
- urgent escalations;
- recovered opportunities;
- confirmed revenue where available;
- estimated opportunity value separately labeled;
- stale estimates/cancellations recovered;
- Knowledge Gap items fixed;
- owner labor saved qualitatively;
- provider usage/cost profile.

Use the first 5 Founding Partners to refine:
- fair-use limits;
- package pricing;
- support burden;
- onboarding time;
- which integrations deserve productized adapters next.

## Rollback rule

Every customer must have a simple rollback path:
- turn off forwarding / restore their normal routing;
- disable the affected BookedRadar feature flag;
- leave CRM/customer records intact unless cleanup is specifically required;
- preserve logs needed to diagnose the issue;
- communicate the scope of the incident clearly.

Reliability outranks feature completeness.
