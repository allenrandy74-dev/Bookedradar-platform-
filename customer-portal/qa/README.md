# Portal acceptance evidence

The portal's dedicated CI workflow runs synthetic unit/security checks and browser checks without production credentials. It reuses `qa/reporting-browser/package-lock.json` and its pinned Playwright dependency.

## Authoring checks

- `npm run check --prefix customer-portal`: passed.
- `npm test --prefix customer-portal`: 37 passing, 0 failing, 0 skipped at initial review.
- Independent read-only review confirmed the same 37 tests and syntax checks; changes requested for HTTP origins, workflow parity, interrupted-save fencing and outcome evidence validation were applied and retested.
- Existing production files are unchanged. The candidate is additive and the API is unmounted.
- Local browser launch was attempted but blocked by the executor's Unix-socket permission restriction. The cloud browser could not reach the executor's loopback server, and the private hosted Site requires the user's ChatGPT sign-in. Do not describe these as successful browser checks.

## Browser suite scope

`browser.mjs` verifies demo labels, search/filter, assignment/status, literal notes, pending-click suppression, unsaved drafts, Escape/focus return, Back/Forward, failure preservation/retry, disabled stale writes, empty/loading/error/expiry clearing, outcome evidence, layout overflow at 320/375/390/768/1440px and no external traffic. It writes a machine-readable result and screenshots. A passed CI run for the precise commit supersedes the initial local-browser limitation; inspect its result before claiming it passed.

## Production gates

This evidence is synthetic. Authentication provider lifecycle, durable adapter integration, session revocation, membership changes, real source projections, production deployment, voice/transfer acceptance, calendar confirmation and customer notification delivery are separate gates.
