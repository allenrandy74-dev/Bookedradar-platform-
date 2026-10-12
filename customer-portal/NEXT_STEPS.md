# Customer portal activation plan

## What exists now

- A private synthetic preview, with no live customer records or provider actions.
- An unmounted customer API, a same-origin client, PostgreSQL storage adapter, hashed-cookie session verifier and reviewable isolated schema.
- A pure source-to-inquiry mapper that preserves independent human workflow.
- 91 passing fast unit/security/model/client/source checks, 16 real Chromium checks and 15 disposable PostgreSQL checks at the verified commit in [QA evidence](qa/README.md).

None of this enables real customer access. Existing phone, CRM, recovery and billing services remain unchanged.

## Minimum path to an isolated connected staging app

1. **Public source publication is approved and completed.** [PR #105](https://github.com/allenrandy74-dev/Bookedradar-platform-/pull/105) is draft and unmerged. It contains only portal source, synthetic fixtures, tests, documentation and isolated QA. Publication approval does not authorize deployment.
2. **Exact-commit CI passed; preserve the gate.** The verified head in [QA evidence](qa/README.md) passed browser layouts at 320/375/390/768/1440px, keyboard/history, error recovery, tenant/object authorization, concurrent notes and audit rollback, plus existing production CI and CodeQL. Every later head still needs its own passing run. Review screenshots as well as the automated results.
3. **Choose and verify the customer identity issuer.** Prefer an existing supported managed identity flow if the business already has one. Do not implement password storage. Login must bind a verified provider identity to an explicitly approved tenant membership, with secure cookie issuance, expiry, logout, recovery and revocation. Never use an administrator bearer token or browser-selected tenant as identity.
4. **Approve the target and minimum persistent access.** Identify the existing approved staging hosting environment, exact HTTPS origin, disposable/isolated database and narrowly scoped runtime role. Review the new schema migration and rollback. Any OAuth client, secret, grant or persistent role creation requires explicit action-time authorization. No new paid provider, subscription or service is approved by this candidate.
5. **Implement the internal source importer.** SOURCE_MAPPING.md explains the actual recovery fields and gaps. It needs coherent bounded reads, safe handling of pruned events, a privileged source-only writer with compare-and-swap and dedicated auditing, and no provider state mutation. The current customer store intentionally refuses source-column writes. No financial reporting endpoint is exposed by the customer API yet.
6. **Wire a staging-only connected interface.** Keep connected and synthetic modes visibly distinct. Mount the API only behind real session verification. Use the same-origin client and explicit source DTOs. Prove end-to-end isolation with two synthetic customer accounts/tenants before selecting any real customer fields.
7. **Separate release review.** Only after staging acceptance should production schema/access, route mounting, deployment and customer invitations be considered for explicit approval. No merge, auto-merge, live deployment or invitation is included here.

## Preferred next decision: inspect existing Wix identity first

Wix officially supports a Wix-managed login page using OAuth 2.0 with PKCE, and recommends server-side token refresh for best security: [Wix login-page guide](https://dev.wix.com/docs/go-headless/authentication/members/wix-login-page/add-a-wix-login-page-js-sdk).

Prefer reusing that managed flow if the existing BookedRadar site supports it, rather than introducing a second identity service. The smallest owner action is to reconnect the already-installed Wix app so the next check can be read-only: confirm the correct site, Members/auth setup, existing OAuth clients and callback configuration, and current plan/cost impact. No paid service is selected or approved. The current site's member/auth setup and any plan/cost impact have not been verified. The connected Wix tool required reauthentication when checked. No login client was registered, no grant was expanded, and no Wix configuration was changed. The preview's ChatGPT sign-in protects the preview only; it is not BookedRadar customer authentication.

After that inventory identifies an exact staging origin and provider configuration, request a separate bounded activation approval: configure only the staging OAuth client/callback, server-side session issuance and revocation, two synthetic test identities explicitly mapped to two staging tenants, and the isolated staging schema/runtime role. State the exact target, permissions and any cost before registering credentials or granting persistent access. Keep real customer enrollment and production route mounting out of that approval.

## Accurate review status

Fast tests establish local synthetic behavior. A private URL establishes deployment of the demonstrator. Neither proves a live login, durable production save, real booking, payment, customer reply or completed human transfer. Those claims require their own observed end-to-end evidence.
