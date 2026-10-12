# BookedRadar customer workspace — isolated candidate

A responsive, interactive **synthetic-data preview**, plus an **inactive, deny-by-default customer API**. This is not an activated customer service. No existing voice, Twilio, OpenAI, SIP REFER, CRM, billing or recovery runtime files are changed.

## Try the preview

From the repository root, with Node 22 or newer:

```sh
npm run preview --prefix customer-portal
```

Open the printed loopback URL. No package installation is needed for the preview or focused unit tests. The server allowlists the five browser files, binds only to loopback, disables browser network connections with CSP, and exposes no API or backend files.

The preview can:
- Search and filter inquiries; inspect intake context and a sample event timeline.
- Assign an inquiry to a demo team member, use allowed workflow transitions, and add internal notes.
- Retain unfinished drafts while closing/reopening an inquiry; clear them on reset/reload.
- Distinguish estimates, customer replies, explicit booking evidence and explicit confirmed payment evidence.
- Exercise empty/loading/error/stale/session-expired/save-failure states from the Preview states menu.

All people, contacts, records, amounts and events are fictional. Example telephone numbers use the reserved 555-01xx range and example.com email addresses. Edits are memory-only and reset on reload. There are no call/send links, credentials, live HTTP clients, booking operations or payment mutations.

## Architecture and boundaries

- `index.html`, `styles.css`, `app.mjs`: dependency-free accessible UI with responsive desktop/mobile layout, native modal focus behavior, URL/history navigation and explicit demo notices.
- `fixtures.mjs`: synthetic records only; example day is fixed at October 12, 2026.
- `model.mjs`: demo selectors, immutable edits, optimistic versions and evidence validation. **Client-side filtering is not security-enforced tenant isolation.**
- `server/api.mjs`: customer API with trusted session resolver and durable-store injection, default disabled. Identity and membership come from the server; client tenant selectors are rejected. Explicit DTOs, object-level tenant checks, membership restrictions, CSRF/origin checks, transitions, concurrency and transaction-coupled auditing are covered by tests.
- `client.mjs`: inactive same-origin transport with session fencing, stale-response suppression, CSRF, optimistic versions and duplicate-save protection; never imported by the demo.
- `server/postgres-store.mjs`, `server/session-resolver.mjs`, `server/schema.sql`: inactive durable PostgreSQL adapters, hashed opaque-cookie lookup and reviewable migration. Pool injection only, with no production connection, migration, credential issuance or automatic activation.
- `server/source-projection.mjs`: pure, inactive mapper grounded in the actual recovery source fields. Tenant/contact/event identity is verified and existing human workflow survives a planned source refresh. No importer or source writer is activated.
- `SERVER_CONTRACT.md`: exact backend contract, source evidence and activation gates. Shared administrator tokens must never be supplied to a customer browser.

The API is deliberately not mounted in `server.js`. The preview does not connect to it. Existing provider action state, automatic dispatch and revenue attribution remain separate from human workflow. Closing an inquiry cannot record a sale, confirm a calendar booking, retry dispatch or alter consent.

## Checks

```sh
npm run check --prefix customer-portal
npm test --prefix customer-portal
# Reuse the repository's existing locked Playwright toolchain:
npm ci --prefix qa/reporting-browser
(cd qa/reporting-browser && npx playwright install chromium)
node customer-portal/qa/browser.mjs
```

Browser QA starts its own synthetic-only server; no production credentials or endpoints are used. It checks desktop and 320/375/390/768px layouts, focus/history, interrupted/error states, note escaping, duplicate-click protection, evidence wording and absence of external requests. Screenshots and results go to `customer-portal/qa/evidence/`. Browser launch is blocked by the current isolated executor's Unix-socket restriction; the standalone suite and dedicated PR workflow provide a reproducible route in CI. A private hosted preview was published separately; its authentication is not the portal's production identity system.

At initial review, 37 focused unit/API tests passed with no skips. The inactive customer transport and durable/session adapter unit tests expanded the local suite; the final count is recorded with the candidate manifest. Live PostgreSQL verification remains a separate CI gate. That is not a claim that the complete original production suite or live integrations passed. The checkout used for authoring is a connector-materialized partial reference snapshot, not a full production checkout. CI operates on the full repository.

## Before any customer launch

Customer identity issuance, reviewed deployment of the durable adapters/migration, authoritative source projection, pagination, real-browser session expiry/revocation, cross-tenant end-to-end tests and operational deployment review must be complete. No live integration is implied by the preview. Never deploy/mount this candidate, provision persistent access, create credentials, or enable customer invitations without explicit authorization.
