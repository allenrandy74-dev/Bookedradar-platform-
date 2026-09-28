# BookedRadar Secret Rotation Runbook

## Goal
Rotate credentials without exposing them in chat, source code, logs, support tickets or screenshots, and without unnecessarily disrupting active callers.

## Rotate immediately when
- a token/key appears in source control, chat, screenshot, ticket or log
- a device/account with production access is lost or compromised
- a provider reports credential exposure
- an authorized user's access should end
- suspicious authentication activity is observed

## Planned rotation
Maintain an inventory of:
- provider
- credential purpose
- environment (test/production)
- tenant scope
- owner
- last rotation date
- next review date

Do not store the credential value in the inventory.

## Safe rotation sequence
1. Identify every service/tenant using the credential.
2. Check current call/service state; avoid elective voice-path changes during active incidents.
3. Create the replacement credential in the provider.
4. Give it only the required scope.
5. Update the target environment through the provider/hosting secret store.
6. Redeploy/restart only if required.
7. Verify health/readiness.
8. Run the smallest controlled acceptance test needed for that credential.
9. Revoke the old credential.
10. Verify again after revocation.
11. Record date, affected systems and verifier—never the secret.

## Voice-path credentials
For OpenAI/Twilio voice credentials:
- preserve a known-good rollback path
- do not rotate several independent voice dependencies simultaneously unless responding to active compromise
- verify inbound acceptance, greeting and human fallback after change
- avoid public-demo load testing

## Customer-specific credentials
A customer credential must never be substituted with another customer's credential to restore service.
If a tenant integration is unavailable, disable/degrade that integration safely while preserving durable lead capture where possible.

## Emergency exposure response
- restrict/revoke exposed credential
- preserve relevant logs/evidence
- create replacement
- update only authorized destinations
- verify no unexpected webhook/API use
- follow the Incident Response Runbook if customer impact or data exposure is possible
