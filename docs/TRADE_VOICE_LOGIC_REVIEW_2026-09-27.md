# Trade voice logic review — September 27, 2026

Scope: the five demo configurations, shared operator instructions and tool descriptions, feature guidance/tool gating, lead capture, booking and transfer handlers. Baseline: 6ba69ba325b6e768a95048506aa66bbc5f22f3d6. This is a source/configuration review, not live-call acceptance.

## Corrections

- HVAC safety wording is conditional on reported danger, rather than appearing to direct every caller to emergency services.
- Shared guidance separates service urgency from immediate danger, requires waiting after questions, and preserves prompt safety guidance when danger is already reported.
- Each trade has specific intake guidance without adding a mandatory question checklist or technical troubleshooting.
- Information-only calls and existing-account requests do not require new-service intake. Unavailable account actions cannot be claimed as completed.
- Out-of-scope work requires business confirmation, not an automatic transfer or promise of coverage.
- Transfer permission remains required. Newly supplied details should be saved when feasible without delaying a direct human request. Failed transfers offer a callback request without promising delivery or timing; no automatic repeat transfers.
- Spoken examples and transfer announcements support the caller's approved language consistently.

## Reviewed behavior

| Demo | Routine path | Important distinction |
| --- | --- | --- |
| HVAC | Repair, maintenance, replacement | No cooling does not automatically mean immediate danger; preserve reported vulnerability/unsafe conditions |
| Plumbing | Leak, drain/sewer, water heater, gas, estimate | Ordinary drip/blocked drain vs reported hazardous condition |
| Electrical | Repair, installation, panel, generator | Urgency question ends the turn; avoid routine emergency speeches and equipment troubleshooting |
| Roofing | Estimate/replacement vs active leak/storm damage | Replacement is not transfer consent; no unsafe inspections or insurance promises |
| Home Services | Identify trade if unclear; retain multiple issues | Ask priority when needed; never promise one technician covers all trades |

Shared: one missing detail per turn; skip supplied details; spell unclear city/street; confirm address and callback; save useful partial lead; preserve corrections; no invented pricing, slots, coverage, dispatch, or response times. Safety and requested human help take priority over routine intake. Caller-ID memory is a hint, not proof of identity.

## Validation

- Existing automated suite: 222/222 passing.
- JavaScript syntax checks pass.
- Generated instructions checked for all five demo configurations: business/safety guidance survives configured length limits; city spelling, transfer permission, and confirmation-only booking rules included.
- All five actual booking adapters rejected a synthetic invented slot locally (`confirmed: false`).
- All five tool sets exclude caller SMS while the SMS integration is disabled.
- No calls, messages, customer outreach, or live bookings performed.

## Limits and next acceptance checks

Prompt rules are not deterministic proof of conversational compliance. Transfer consent is enforced through instructions, not an independent server-side speech-consent validator. Live end-to-end tests remain needed: one routine call per trade; electrical urgency/pause; roofing quote with transfer declined; corrected/spelled city; immediate request for a person; Spanish interaction. Use simulated scenarios, not real hazards.

These demos collect appointment preferences; they do not demonstrate live scheduling or production dispatch. HVAC has different web-chat/feature entitlements from the other demos; they are not five identical end-to-end product deployments. No entitlement, SMS enablement, pricing, phone routing, credential, or booking-mode changes were made.

Rollback: restore the six changed source/configuration files from baseline 6ba69ba and redeploy. This restores the already-deployed city vocabulary and prior electrical/transfer fixes.
