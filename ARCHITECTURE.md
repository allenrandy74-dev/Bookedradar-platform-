# BookedRadar Architecture v1.0

Channels:
Phone / SMS / Email / Website / CRM / Field-service system
                         |
                         v
                 Opportunity Events
                         |
                         v
                  Recovery Engine
        +----------------+----------------+
        |                |                |
        v                v                v
  Compliance        Action Queue       Escalation
  / suppression     / playbooks        / human tasks
        |                |                |
        +----------------+----------------+
                         |
                         v
                    Integrations
         CRM / Calendar / Messaging / Email
                         |
                         v
                    RadarProof
      estimated opportunity vs confirmed revenue

Design rules:
- Multi-tenant policy comes from a customer configuration.
- No invented appointment availability.
- No invented pricing.
- Marketing outreach is consent-aware.
- Opt-out is a hard suppression.
- Safety issues escalate; the AI does not diagnose hazardous conditions.
- Estimated opportunity value is not labeled as revenue.
- Confirmed revenue requires an explicit source event.
