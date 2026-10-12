# Customer portal activation plan

## What exists now

- A private synthetic preview, with no live customer records or provider actions.
- An unmounted customer API, a same-origin client, PostgreSQL storage adapter, hashed-cookie session verifier and reviewable isolated schema.
- A pure source-to-inquiry mapper that preserves independent human workflow.
- Fast unit/security/contrast checks, plus authored Chromium and disposable PostgreSQL acceptance suites.

None of this enables real customer access. Existing phone, CRM, recovery and billing services remain unchanged.

## Minimum path to an isolated connected staging app

1. **Publish the candidate only if approved.** The existing BookedRadar repository is public. Explicit approval is needed to put new portal source, synthetic fixtures and CI workflow there. Keep the pull request draft and unmerged. The approved-public-source step does not authorize deployment.
2. **Run exact-commit CI.** Review both the browser job and disposable PostgreSQL 18 job. Check screenshots at 320/375/390/768/1440px, keyboard focus/history, error recovery, tenant/object authorization, revocation, concurrent notes and audit rollback. Re-run the unchanged production checks on the complete checkout. The current authoring executor cannot run Chromium or PostgreSQL, so it has no passing evidence for those stages yet.
3. **Choose and verify the customer identity issuer.** Prefer an existing supported managed identity flow if the business already has one. Do not implement password storage. Login must bind a verified provider identity to an explicitly approved tenant membership, with secure cookie issuance, expiry, logout, recovery and revocation. Never use an administrator bearer token or browser-selected tenant as identity.
4. **Approve the target and minimum persistent access.** Identify the existing approved staging hosting environment, exact HTTPS origin, disposable/isolated database and narrowly scoped runtime role. Review the new schema migration and rollback. Any OAuth client, secret, grant or persistent role creation requires explicit action-time authorization. No new paid provider, subscription or service is approved by this candidate.
5. **Implement the internal source importer.** SOURCE_MAPPING.md explains the actual recovery fields and gaps. It needs coherent bounded reads, safe handling of pruned events, a privileged source-only writer with compare-and-swap and dedicated auditing, and no provider state mutation. The current customer store intentionally refuses source-column writes. No financial reporting endpoint is exposed by the customer API yet.
6. **Wire a staging-only connected interface.** Keep connected and synthetic modes visibly distinct. Mount the API only behind real session verification. Use the same-origin client and explicit source DTOs. Prove end-to-end isolation with two synthetic customer accounts/tenants before selecting any real customer fields.
7. **Separate release review.** Only after staging acceptance should production schema/access, route mounting, deployment and customer invitations be considered for explicit approval. No merge, auto-merge, live deployment or invitation is included here.

## Identity option researched, not selected

Wix officially supports a Wix-managed login page using OAuth 2.0 with PKCE, and recommends server-side token refresh for best security: [Wix login-page guide](https://dev.wix.com/docs/go-headless/authentication/members/wix-login-page/add-a-wix-login-page-js-sdk).

That may fit the existing Wix ecosystem, but the current site's member/auth setup and any plan/cost impact have not been verified. The connected Wix tool required reauthentication when checked. No login client was registered, no grant was expanded, and no Wix configuration was changed. The preview's ChatGPT sign-in protects the preview only; it is not BookedRadar customer authentication.

## Accurate review status

Fast tests establish local synthetic behavior. A private URL establishes deployment of the demonstrator. Neither proves a live login, durable production save, real booking, payment, customer reply or completed human transfer. Those claims require their own observed end-to-end evidence.
