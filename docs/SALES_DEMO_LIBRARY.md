# BookedRadar Sales Demo Library

Updated: 2026-09-25

Purpose: give Randy a prospect-specific demonstration without changing the proven production phone route or pretending Demo HVAC is the prospect's company.

## Demo rule
- The live phone number remains routed to **Demo HVAC** until a separately tested demo-routing mechanism or additional demo numbers are approved.
- Never rename Demo HVAC to a real prospect or use a prospect's branding without permission.
- For non-HVAC meetings, say: "The live phone demo is running on our HVAC sandbox. Let me show you how the exact same workflow is configured for a business like yours."
- Use synthetic names, addresses, phone numbers and estimates.
- Do not claim a recovery is real revenue. Label examples **DEMO / SYNTHETIC**.

---

# 1 — HVAC: Demo HVAC
## What to demonstrate
Caller: "My AC stopped cooling and it's 82 degrees inside."

Operator should collect:
- first and last name
- callback number
- exact service address and spelling confirmation
- no-cooling/system problem
- urgency
- preferred timing
- whether caller wants a human

Human handoff:
- internal SMS summary
- 10-second hold
- REFER transfer

Recovery example:
- $9,500 replacement estimate sent
- no response for 9 days
- approved follow-up
- customer replies asking about financing
- automation stops
- human task created
- estimate accepted -> RECOVERED
- revenue only becomes confirmed when source system/business confirms it

Show value:
- peak-season overflow
- after-hours capture
- repair vs maintenance vs replacement classification
- financing questions
- replacement-estimate recovery

---

# 2 — Plumbing: Demo Plumbing
Synthetic business: **Demo Plumbing & Drain**

## Live-style caller scenario
Caller: "I've got water coming through the ceiling under the upstairs bathroom."

Operator should collect:
- caller identity and callback
- exact address
- source/location of leak if known
- whether water is actively flowing
- immediate safety/property-protection context without diagnosing
- urgency
- preferred timing

Escalation rule:
Active flooding / major leak -> urgent human escalation.
Routine faucet, fixture, estimate or maintenance request -> normal callback workflow.
Gas odor / suspected gas emergency -> safety instructions and emergency/utility escalation; BookedRadar does not diagnose.

## What the business receives
DEMO transfer summary:
BookedRadar transfer — Demo Plumbing & Drain
Caller: Jane Carter
Service: Active upstairs plumbing leak
Urgency: urgent
Preferred timing: ASAP
Service address: 123 Demo Oak Dr
Callback: synthetic test number

## Recovery scenario
Water-heater replacement estimate: $3,800.
Estimate idle 6 days.
Customer replies: "Can you tell me what financing you offer?"
Result:
- follow-up stops
- status becomes ENGAGED
- financing question becomes human action
- accepted estimate becomes RECOVERED only after acceptance/booking evidence

Show value:
- emergency vs routine sorting
- fewer unnecessary on-call interruptions
- complete addresses/problem details before handoff
- financing/estimate recovery

---

# 3 — Electrical: Demo Electric
Synthetic business: **Demo Electric & Generator**

## Live-style caller scenario
Caller: "Half the house lost power and I smell something hot near the panel."

Operator behavior:
- capture name/callback/address
- treat as potentially safety-sensitive
- do not troubleshoot the electrical panel
- advise caller to move to safety / use emergency services or utility when appropriate under the configured safety rule
- escalate immediately according to contractor policy

Routine contrast:
Caller: "I'd like an estimate for a standby generator."
Collect:
- address
- generator/estimate interest
- callback
- preferred consultation timing
- no emergency escalation

## Recovery scenario
Generator estimate: $12,500.
Idle 8 days.
Customer reply: "Does this include the transfer switch, and do you finance?"
Result:
- ENGAGED
- automation stops
- task summarizes both questions
- human estimator receives context
- only confirmed acceptance/revenue is credited as recovery

Show value:
- safety-aware triage
- generator leads separated from emergencies
- broad geographic routing
- high-value estimate recovery

---

# 4 — Roofing / Storm Restoration: Demo Roofing
Synthetic business: **Demo Roofing & Storm**

## Live-style caller scenario
Caller: "A tree limb hit the roof in last night's storm and water is getting into the bedroom."

Operator should collect:
- name/callback
- property address
- damage type
- active water intrusion
- whether temporary emergency protection is being requested
- inspection request
- preferred timing
- insurance context only as factual information; do not promise coverage

## Surge scenario
Show a storm-day queue:
- emergency tarp request
- routine free inspection
- siding damage
- gutter damage
- existing estimate question
- financing question

BookdedRadar sorts each into the appropriate next action rather than treating every storm caller alike.

## Recovery scenario
Roof replacement estimate: $18,700.
Idle 7 days.
Customer replies: "We're waiting on insurance. Can someone explain the payment options?"
Result:
- ENGAGED, not falsely RECOVERED
- automation stops
- project-manager task created
- financing/insurance context preserved
- later signed contract -> RECOVERED
- confirmed collected/contract revenue remains separately sourced

Show value:
- storm-volume overflow
- inspection intake
- emergency vs routine sorting
- estimate follow-up
- structured project-manager handoff

---

# 5 — Multi-trade Home Services: Demo Home Services
Synthetic business: **Demo Home Services**

Services:
- HVAC
- plumbing
- electrical
- generators

## Caller scenario
Caller: "I'm not sure who I need. The generator started, but part of the house still has no power."

Demonstrate:
- BookedRadar does not force the caller to know the department
- captures the problem and location first
- applies safety rules
- routes/classifies for electrical/generator review
- preserves one customer record rather than creating disconnected leads

Second scenario:
Caller asks about an HVAC maintenance membership and also mentions a dripping water heater.
Demonstrate multi-service capture without repeatedly asking for name/address/callback.

Show value:
- one front door for multiple departments
- consistent intake
- fewer transfers between office staff
- cross-service opportunity capture
- membership and estimate follow-up

---

# 6 — Full Scheduling / Dispatch Discovery Demo
This is **not included in the standard $497 pilot** unless separately scoped and agreed.

Synthetic business: **Demo Service Scheduler**

Demonstrate what BookedRadar would need before confirming live appointments:
- service catalog
- average job durations
- technician skills/certifications
- territories
- travel-time rules
- working hours
- lunch/on-call rules
- emergency slots
- equipment/parts constraints where relevant
- calendar/field-service integration
- cancellation/reschedule rules

Explain:
"Basic BookedRadar can capture the appointment request immediately. Full autonomous scheduling is a separately configured service because we need your real capacity, travel and job-duration rules before we promise a time to a customer."

This demonstrates why the higher-level scheduling package has additional value without overpromising.

---

# 7 — What to show after every demo call
Use the same four-screen story regardless of trade:

1. **Caller experience**
   Natural branded conversation and structured intake.

2. **Business handoff**
   SMS/email/CRM task with the exact information the team needs.

3. **Opportunity lifecycle**
   Captured -> Engaged -> Booked/Accepted -> Recovered -> Revenue Confirmed.

4. **RadarProof**
   Show what BookedRadar can prove:
   - opportunity source
   - follow-up actions
   - customer response
   - booking/acceptance evidence
   - confirmed revenue only when a trusted source confirms it

---

# 8 — Randy's 5-minute prospect demo flow
Minute 0-1: "Tell me how calls are handled today when everyone is busy or the office is closed."

Minute 1-2: Run or describe the vertical-specific caller scenario.

Minute 2-3: Show the business handoff: "This is what your team receives."

Minute 3-4: Show the recovery example: "Now suppose the estimate goes quiet."

Minute 4-5: Ask: "Which part of that would help you most—after-hours coverage, overflow, estimate follow-up, or scheduling?"

Do not lead with AI architecture. Lead with the prospect's workflow.

---

# 9 — Demo readiness
LIVE AND PROVEN:
- Demo HVAC phone intake
- CRM capture
- transfer SMS
- 10-second transfer hold
- REFER handoff
- email/human-task/human-alert integrations
- recovery engine and RadarProof concepts

READY AS SALES SCENARIOS:
- Plumbing
- Electrical / generator
- Roofing / storm restoration
- Multi-trade home services
- Full scheduling discovery

NEXT ENHANCEMENT:
Create a controlled demo-profile selector or dedicated demo numbers so Randy can make a real phone call where the assistant answers as Demo Plumbing, Demo Electric or Demo Roofing without editing the production tenant before a meeting.
