# BookedRadar Deployment Readiness Matrix

| Service | Software status | External activation needed |
|---|---|---|
| AI phone operator | Ready | OpenAI API key/webhook + SIP phone number/trunk |
| Human call transfer | Ready | Tenant escalation phone number + SIP REFER capable route |
| Missed-call recovery | Ready | Missed-call source webhook + SMS/CRM channel |
| Web-lead response | Ready | Customer form/CRM webhook + email/CRM channel |
| After-hours handling | Ready | Same as lead source; urgency policy configured |
| Estimate follow-up | Ready | Estimate event source + email/CRM channel |
| Cancellation recovery | Ready | Cancellation event source + SMS/CRM channel |
| Dormant reactivation | Ready | Customer list/event source with consent fields |
| Opt-out / suppression | Ready | Inbound reply webhook from messaging provider |
| Confirm-only scheduling | Ready | None beyond human follow-up channel |
| Live booking | Ready via adapter contract | Customer calendar/dispatch webhook |
| Wix CRM contact/tasks | Ready | Tenant Wix API key/site ID |
| SMS | Ready via Twilio adapter | Twilio credentials + sending number |
| Email | Ready via provider webhook | Authorized email provider endpoint |
| RadarProof | Ready | Real events/revenue confirmation source |
| Automatic recovery worker | Implemented; production uses Postgres | Verify database-backed coordination and tenant delivery acceptance across deployed replicas |
| Backups/retention | Recovery tooling and isolated drills documented | Confirm current managed Postgres backups, protected destination, retention and restore acceptance |

“Ready” means the code path, policy controls, tests, and deployment configuration are present. It does not mean an outside provider account has been authorized or purchased.

Production storage is authoritative Postgres. Two stateless application instances are documented; verify the current Render inventory before changes. The JSON archive helper is for legacy/file-backed recovery, not a backup of the live database. Proof Pilot status is advisory: activation also requires the cap-control acceptance described in [pilot operations](docs/PILOT_OPERATIONS_RUNBOOK.md).
