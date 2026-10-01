# Private lab admission deployment

This candidate retains the existing Render lab command `node scripts/private-voice-lab-start.mjs`. It does not change the production Docker command, provision resources, enable voice or create pilot acceptance records.

The lab wrapper validates the exact service name, configured managed database host and database name, private OpenAI project, forbidden external credentials and synthetic-only routes. It generates isolated tenant configurations with dispatch, billing, alerts, transfers, CRM, SMS and web chat disabled. The database must already contain the validated `private_voice_lab_empty_20260929` migration with passing table-count and content reconciliation. Validation runs in a read-only transaction. Missing, unfamiliar or failed migrations stop startup; the wrapper never initializes, imports or repairs a database.

Before manual lab deployment, verify the existing lab service and database IDs, Docker override, two instances, auto-deploy off, disabled voice and other action flags, and the reviewed candidate's complete passing checks. Record the last accepted lab commit for rollback. Do not point production at this lab branch or copy production provider credentials into the lab.

Deploy only the reviewed candidate commit to the existing lab, preserving its command and disabled flags. Verify deployed commit and health on both instances, authoritative Postgres, five synthetic tenants and billing/voice disabled. Run the database-only guarded admission check after deployment. A healthy deployment does not establish real caller fallback acceptance.

Real voice tests require a separately verified remaining aggregate budget, private provider routing and a recorded safe rejection/fallback plan. A customer pilot remains disabled until actual carrier fallback, alert receipt and customer-specific acceptance are recorded. SIP rejection alone does not redirect a caller.
