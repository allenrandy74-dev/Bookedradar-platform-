# Portal acceptance evidence

## Verified candidate

On October 12, 2026, head `e0ecbb864edc685dbbc561ee0b994b72f65c3605` of [draft PR #105](https://github.com/allenrandy74-dev/Bookedradar-platform-/pull/105) passed:

- Syntax checks and **91/91** synthetic unit/security/model/client/source tests, zero skips.
- **16/16** real Chromium browser checks, including 320/375/390/768/1440px layouts.
- **15/15** disposable PostgreSQL 18 tests, zero skips (14 nested scenarios plus the parent test).
- Existing repository CI, including production dependency audit, full tests, 200 simulations, PostgreSQL state and maintenance Docker checks.
- CodeQL.

[Portal QA run](https://github.com/allenrandy74-dev/Bookedradar-platform-/actions/runs/38257323997), [existing CI run](https://github.com/allenrandy74-dev/Bookedradar-platform-/actions/runs/38257323953), [CodeQL run](https://github.com/allenrandy74-dev/Bookedradar-platform-/actions/runs/38257323940).

[Browser evidence archive](https://github.com/allenrandy74-dev/Bookedradar-platform-/actions/runs/38257323997/artifacts/11750264524) contains screenshots and machine-readable results. Its SHA-256 is `c3fa1d508e4147eb23720034c8318d39163365c5032cabd487fd95dc43c7487a`.

These links prove the stated commit only. Later commits must pass their own CI; check the PR's current head rather than assuming an earlier green run covers newer changes. The subsequent evidence-capture changes add screenshots at each tested width and wait for transient toasts to disappear. They do not alter the application's static assets.

## What the browser suite establishes

`browser.mjs` verifies persistent demo labels, search/filter, assignment/status, literal notes, pending-click suppression, unsaved drafts, Escape/focus return, Back/Forward, failed-save preservation/retry, disabled stale writes, empty/loading/error/expiry clearing, outcome evidence, layout overflow and absence of external requests. It uses only the synthetic loopback preview and the repository's pinned Playwright toolchain. Dialog screenshots use the viewport so off-screen page content is not mistaken for the modal's layout.

The first run exposed a test race with asynchronous hash navigation. The next exposed a test that waited on a previous success toast instead of the new saved note. Both were corrected with actual route/record-state assertions; no application behavior assertion was removed or relaxed. The complete suite then passed.

## What PostgreSQL establishes

The real PostgreSQL 18 suite checks migration rollback, hashed session expiry/revocation, membership and tenant rejection, identical-ID cross-tenant isolation, composite foreign keys, durable notes/updates/audits, stale/concurrent writes, a blocked note writer receiving both committed notes, atomic audit rollback, membership revocation locking and immutable source fields. It creates and removes only a fresh synthetic schema in an explicitly guarded disposable loopback database.

## Remaining release gates

The preview is synthetic, and the API/adapters remain unmounted. Real identity-provider login, issuer/logout/recovery, staging end-to-end authorization, approved persistent access, source import, production deployment, calendar confirmation and customer notification delivery are separate gates. Passing synthetic CI is not customer launch approval or a formal accessibility certification.
