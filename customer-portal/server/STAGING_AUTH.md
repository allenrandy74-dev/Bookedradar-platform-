# Isolated lab authentication

This implementation targets only `https://bookedradar-private-voice-lab-20260929.onrender.com`, public Wix client `f6191cf3-548f-4883-98a4-27cdd0fcff3a`, Wix site `dc96494e-5565-41be-8513-deeeedcf59d7`, and the existing lab database/schema. No client secret, admin token, provider access token, or refresh token is sent to the browser. Provider access/refresh tokens are discarded after the short server-only flow; there is no token refresh/background access.

## Activation boundaries

- Normal runtime validates the actual Render service/private-lab flags, fixed database host/name/port, exact HTTPS origin and disabled outbound provider features before connecting. The shared pool also verifies `current_database()` over the internal connection.
- `staging-schema-setup.mjs` is an explicit setup-only entrypoint. Normal runtime imports only the read-only readiness module. Setup serializes through a transaction advisory lock, verifies the migration-source digest, and never adopts or repairs a mismatched existing schema.
- Readiness checks a stored baseline captured immediately after the reviewed migration, including tables, columns, types, defaults, constraints/FKs, indexes/validity, and unexpected functions/triggers. The catalog digest detects drift; it is not protection against an administrator who can rewrite both schema and metadata. The existing lab database role remains broad. Schema-qualified queries do not constitute database-enforced least privilege.
- Only a newly created schema receives fixed synthetic fixtures: two inactive tenants, two inactive members, three synthetic inquiries, zero identity bindings. Existing schemas are never reseeded or reactivated.
- Unknown verified Wix members get a nonsecret, site/client/subject-bound SHA256 fingerprint and no local session or customer data. The full provider subject and tokens are not displayed or saved in discovery records. There is no first-user privilege, invitation endpoint or HTTP enrollment endpoint.
- Separate explicit owner confirmation naming that fingerprint is required before the operator invokes `staging-bind-owner.mjs`. This utility uses the strict runtime destination gate, requires a fresh (15-minute) verified discovery, and can activate only `portal-staging-demo / owner-pilot / staging-owner-pilot`. Activation plus its confirmation-reference audit is atomic. A different or previously revoked binding requires separate review. No database role, password, grant or provider credential is created.

After that specific approval, an operator with the existing approved lab shell/environment may run:

```sh
node customer-portal/server/staging-bind-owner.mjs --activate-owner-pilot <verified-fingerprint> <approval-reference>
```

The owner then signs in again. The utility never logs connection strings or raw provider data.

## Login and session protocol

1. `GET /api/auth/login` accepts only same-origin or direct browser navigation (`Sec-Fetch-Site: same-origin` or `none`), rejecting foreign Origins. It atomically admits a shared rate-limited attempt, revokes the previous local identity, advances the durable browser generation, and stores a five-minute PKCE flow.
2. The server obtains an anonymous Wix visitor token and a managed login redirect. Redirect destinations are pinned to the verified published `https://www.bookedradar.com` origin. Unfamiliar origins fail closed; no caller-provided return URL is accepted.
3. Wix returns `code` and `state` in the fragment at `/api/auth/callback`. A minimal CSP-hashed callback script scrubs the fragment before posting JSON to the same-origin callback, with `X-Login-CSRF: state`. No localStorage/sessionStorage or provider tokens are used by that page.
4. Callback POST requires exact Origin, JSON, state/header agreement and the secure host-only HttpOnly browser cookie. Shared compare-and-swap consumes the state once and erases the stored verifier while retaining cancellation intent. The code is exchanged with PKCE server-side.
5. Token-info must report active, unexpired `MEMBER`, the exact client/site, and a bounded subject. Known snake/camel aliases are normalized; conflicting, missing or incorrectly typed values fail closed. Unverified JWT contents and email addresses never establish identity.
6. Session issuance rechecks the current unrevoked browser generation and consumed intent inside the same database transaction as the explicit identity binding and membership. A new login or logout invalidates older callbacks, including those already waiting for Wix. Sessions are bound to that browser generation, so a late old cookie cannot authorize after an account switch.
7. The local session token is fresh random 32-byte material, stored only as SHA256. Secure HttpOnly `__Host-` cookies use Path=/ and SameSite=Lax. Session lifetime is at most 30 minutes and never exceeds verified Wix token expiry. `POST /api/auth/rotate` has a single winner, revokes the old token and preserves absolute expiry.
8. `POST /api/auth/logout` requires exact Origin and session CSRF when authenticated. Shared local revocation and pending-flow cancellation commit before returning the fixed Wix browser logout URL. Provider availability cannot restore local access. This is not a claim of all-device or refresh-token revocation.

Authenticated API reads, except `/session`, carry the session's `X-CSRF-Token` marker. A tab holding identity A cannot silently receive identity B's data after another tab changes the cookie. Writes additionally lock and recheck the active local session, current browser generation, identity binding, tenant and membership inside the workflow transaction. Completed revocations deny a later transaction; a revocation waits for an already-authorized locked transaction to finish.

Shared admission permits at most 10 login starts per minute and 60 per hour across both lab instances. This deliberately conservative pilot limit applies before Wix calls. Cleanup removes at most 100 expired/revoked rows per auth table per admitted start, only in this schema. Identity bindings, authorization audit and inquiry data are not purged by cleanup.

## Verification status

Fast synthetic tests cover provider request shapes, audience/subject checks, state/PKCE replay, two-instance callbacks, account switch, delayed callbacks versus logout/new login, rotation, read binding and transaction-time revocation. They make no Wix or database connections.

`test/staging-postgres.integration.mjs` verifies the same invariants with actual PostgreSQL 18 only after the existing strict disposable-database guard. It uses a test-only metadata shim to exercise exact lab-gated adapters inside the guarded `*_portal_test` database. No runtime override exists. The fixed staging schema must be absent, is created by that test, and is dropped only if that test created it. It never connects to the real lab. Run results must be checked separately; source/syntax/unit success is not PostgreSQL verification.

The approved owner sign-in still needs to establish the real MEMBER fingerprint, after which explicit activation and browser smoke tests can verify actual Wix response aliases, redirect/cookie behavior, cross-instance login/logout, and access to only synthetic data.

## Verified primary references

- [Wix-managed login with PKCE and fragment callback](https://dev.wix.com/docs/go-headless/authentication/members/wix-login-page/add-a-wix-login-page-rest)
- [Headless token retrieval](https://dev.wix.com/docs/api-reference/business-management/headless/authentication/retrieve-tokens)
- [Token introspection](https://dev.wix.com/docs/api-reference/app-management/oauth-2/token-info)
- [Server-side authentication sample flows](https://dev.wix.com/docs/api-reference/business-management/headless/authentication/sample-flows)
- [Direct browser logout endpoint](https://dev.wix.com/docs/api-reference/business-management/headless/authentication/logout)
