# Customer portal server contract

## State of this candidate

This is an isolated, inactive portal backend with a PostgreSQL store adapter and opaque-session verification. It does not create a listener, mount routes in the existing application, implement a login provider, create credentials, connect a database, or deploy anything. With no injected session resolver and store, every service request returns `503 portal_not_configured`.

`server/api.mjs` exports a framework-independent request service and Node HTTP adapter. `server/postgres-store.mjs` implements durable, tenant-scoped operations against an injected, already authorized PostgreSQL pool; it creates no connection itself. `server/session-resolver.mjs` validates existing opaque sessions without issuing them. `server/schema.sql` is a reviewable migration for six normalized tables in a new isolated schema; it is not run on startup and has not been applied to production.

The in-memory store in `test/api.test.mjs` is a synthetic test fixture only. The PostgreSQL integration suite is implemented separately and must be run on the explicitly guarded disposable database before claiming real-database validation. Local unit tests do not prove PostgreSQL locking or durability. No customer identity provider, login callback, data importer, live database access, or deployment has been activated.

## Verified repository context

These are observations of the supplied source snapshot, not claims of an existing customer-login system:

- [`../src/auth.js`](../src/auth.js), lines 10–29, accepts a shared bearer secret. [`../server.js`](../server.js), lines 1509–1510, uses it for ingest and admin guards. Neither establishes an individual customer identity or tenant membership.
- [`../server.js`](../server.js), lines 801–817, resolves a tenant from a request header/query. [`../MULTI_TENANT.md`](../MULTI_TENANT.md), lines 36–40, documents that selector. Selection is not customer authorization; this scaffold rejects client tenant selectors.
- [`../server.js`](../server.js), lines 2443–2466, exposes the existing RadarProof route using an admin token/public flag and tenant selection. The customer portal does not use or re-expose that route.
- [`../ARCHITECTURE.md`](../ARCHITECTURE.md), lines 27–35, separates estimated opportunity from confirmed revenue and requires source evidence for confirmed revenue. This scaffold has no booking, communication, payment, or revenue mutation endpoints.
- The supplied candidate source is partial: the existing application's full dependency tree and package scripts are not present at repository root. Tests here are self-contained Node tests, not a claim that the full application's original CI ran.

## Identity and authorization boundary

For an approved future integration, compose the provided modules as follows. This is a wiring example, not startup code or permission to activate it:

```js
const store = createPostgresPortalStore({ pool: alreadyAuthorizedPool });
const resolveSession = createOpaqueSessionResolver({ store });
const handler = createCustomerPortalHandler({
  store, resolveSession, allowedOrigins: ['https://approved-customer-host.example']
});
```

There is no default pool, connection string, environment-variable autoconnection, automatic schema migration, or fallback customer login. The existing `pg` dependency is injected by the embedding application; no new runtime dependency is added.

`resolveSession({ method, url, headers })` is a trusted server-side adapter. It must validate a revocable opaque customer session against a real identity provider/session store, including signature or lookup, expiry, logout/revocation, and an authoritative tenant membership binding. It returns `null` for unauthenticated requests, or:

```json
{
  "userId": "server-verified-user-id",
  "memberId": "server-verified-membership-id",
  "tenantId": "server-bound-tenant-id",
  "tenantName": "Customer business name",
  "expiresAt": "2026-10-12T13:00:00.000Z",
  "csrfToken": "server-generated-session-bound-random-value"
}
```

This is a principal schema example, not a usable session. The provided resolver verifies existing sessions only; an approved identity provider/login flow must establish those sessions first. Never derive any field from an unverified JWT payload, a tenant picker, query parameter, arbitrary user/member header, browser storage, shared admin bearer token, or a client-supplied membership. Do not forward `BOOKEDRADAR_ADMIN_TOKEN` to a browser. If tenant switching is later added, the server must revalidate that user's membership and issue a new session binding; no tenant-switch endpoint is provided here.

The API verifies expiry, then looks up the active membership using `(tenantId, memberId)` and confirms its `userId`. Role comes from that current membership, not a role claim from the client/session. Supported roles:

- `viewer`: read inquiries and eligible assignees.
- `operator`: read, update workflow status/assignment, add an internal note.

Operators have access to all portal inquiries in their bound tenant; assignment is a workflow field, not an object access restriction. An assigned-only access model would require a separate authorization design. Write authorization is rechecked with database locks within the mutation transaction. If a membership revocation commits first, the write is rejected. If a write acquires the membership lock first, revocation waits for that transaction to finish. Session revocation is checked at request admission: a request already admitted may complete after its session token is revoked. A stricter in-flight session-revocation barrier would require extending the service transaction contract, and is not claimed here.

Any header/query key containing `tenant` after case/punctuation normalization is rejected. Body schemas reject tenant selectors and all unknown fields. An inquiry is fetched only with the server-bound tenant and requested object ID; a missing or other-tenant object returns the same `404 not_found`. Related assignees and note authors are resolved only in that tenant. Historical authors/assignees require retained tenant-scoped membership rows, even if no longer active; newly assigned members must be active operators.

## Cookie session and browser protections

The resolver reads only `__Host-bookedradar_portal` from `Cookie`. Duplicate, quoted, noncanonical, malformed or oversized cookie values are rejected. It accepts exactly the base64url encoding of a 32-byte opaque token, sends only `SHA256(token-as-UTF8)` to the store, and queries an unrevoked, unexpired session joined to an active tenant and membership. Tenant and member/user IDs come from that stored relation. There is no bearer-token, URL, or arbitrary identity-header fallback.

The session table stores only the 32-byte hash and server-owned membership/expiry/revocation metadata, not raw cookie tokens. The resolver derives a deterministic CSRF value as `HMAC-SHA256(key=opaque-token, message=bookedradar-portal-csrf-v1)` encoded as base64url, exposing no raw session cookie. No CSRF secret is persisted. Hash lookup is the one deliberately unscoped database query: it establishes the trusted session tenant before any inquiry lookup; all customer objects are subsequently tenant-scoped.

The future, separately approved identity flow must create sufficiently random opaque tokens only after successful identity verification, bind the verified membership, set `__Host-bookedradar_portal` with `Secure; HttpOnly; Path=/; SameSite=Lax` or stricter and no `Domain`, implement rotation/logout/revocation, and never accept a caller-selected tenant as proof of membership. HttpOnly and Secure attributes are not visible on incoming Cookie headers, so the resolver cannot verify that the issuer set them. No issuer, token minting, `Set-Cookie`, session insertion API, membership grant, or logout endpoint is included.

Every unsafe request requires all of the following:

- A current operator membership.
- At least one explicitly configured exact origin in `allowedOrigins` and a session-bound CSRF token of 32–512 characters. Missing protection configuration returns `503 write_protection_not_configured`.
- An `Origin` exactly matching the configured allowlist, with scheme and port. No wildcard or suffix matching, `null`, missing origin, or reflected request host.
- `X-CSRF-Token` matching the trusted session token using a constant-time comparison.
- `Content-Type: application/json`.

`Sec-Fetch-Site: cross-site` is rejected. Supplied read-request Origins must also match the allowlist. The handler emits no CORS permission headers. Do not mount it behind permissive inherited CORS settings. Production origins must use HTTPS; HTTP support exists only for loopback development/testing. The embedding production application must enforce TLS, secure HttpOnly host-only cookies, appropriate SameSite policy, session rotation and expiry, CSP/frame restrictions, trusted reverse-proxy configuration, request/header timeouts, rate limiting, and read/write request limits. Those hosting/auth controls are pending; this scaffold does not claim to supply them.

All service responses use no-store/private cache headers and a server-generated request ID. Unexpected errors return a generic availability error; exception messages, incoming headers, tokens, raw records, and note contents are not logged or reflected.

## API and DTOs

Base path: `/api/customer-portal/v1`.

| Method | Path | Request | Success payload |
| --- | --- | --- | --- |
| GET | `/session` | None | `{ ok, session: { userId, memberId, tenant: { id, name }, role, canEdit }, csrfToken }` |
| GET | `/members` | None | `{ ok, members: [{ id, name }] }`, active tenant operators only |
| GET | `/inquiries?limit=100` | Optional limit 1–100 | `{ ok, inquiries: [...], limit }` |
| GET | `/inquiries/:id` | None | `{ ok, inquiry }` |
| PATCH | `/inquiries/:id` | `{ version, status?, assigneeId? }` | `{ ok, inquiry }` |
| POST | `/inquiries/:id/notes` | `{ version, text }` | `201 { ok, inquiry }` |

Every service payload also has `requestId`. Errors are `{ ok: false, error: "stable_error_code", requestId }`; HTTP-adapter parse/size errors omit the request ID. IDs are 1–128 ASCII alphanumeric/underscore/hyphen characters and begin with an alphanumeric character.

An inquiry's minimal DTO is:

```json
{
  "id": "inquiry-id",
  "customerName": "Synthetic customer",
  "contact": { "email": "customer@example.test", "phone": "+15550100101" },
  "subject": "Synthetic service request",
  "summary": "Customer inquiry summary",
  "source": "phone",
  "receivedAt": "2026-10-12T12:00:00.000Z",
  "updatedAt": "2026-10-12T12:00:00.000Z",
  "status": "new",
  "assigneeId": null,
  "version": 1,
  "notes": [{ "id": "note-id", "text": "Internal note", "authorId": "member-id", "createdAt": "2026-10-12T12:00:00.000Z" }]
}
```

This response is built field by field; source records are never spread into it. No provider metadata, raw contacts, credentials, audit stream, financial data, or raw recovery snapshots are exposed. Contacts come from the scoped inquiry projection; an eventual source adapter must verify the inquiry's customer/contact linkage before constructing it. No global snapshot filtered in the browser is acceptable.

List reads are bounded to at most 100 results; a pagination adapter/UI is pending. The response is a bounded view, not a claim to be the complete tenant history or a basis for all-time aggregate totals. Durable source adapters should fetch only the bounded tenant projection and load child records in bounded batches. Notes are capped at 2,000 characters each and 1,000 per inquiry. Values are plain text: the frontend must use text rendering, never HTML interpolation. Body reads are capped at 8,192 bytes. No edits/deletions of existing notes are provided.

Workflow transitions are deliberately distinct from provider dispatch, booked appointments, and revenue:

- `new` → `in_progress`, `closed`
- `in_progress` → `waiting`, `closed`
- `waiting` → `in_progress`, `closed`
- `closed` → `in_progress`

No-op patches return `400 no_change`; disallowed transitions and stale versions return `409`. The UI must refetch on `version_conflict` and ask the user to review the newer record instead of silently replaying their write. Every successful mutation increments the inquiry version exactly once.

## Implemented durable PostgreSQL store

The injected store exposes the API's existing interface. Reads of customer objects are tenant-scoped:

```text
getMember(tenantId, memberId) -> member | undefined
listMembers(tenantId) -> member[] (bounded at 1,000)
getInquiry(tenantId, inquiryId) -> inquiry | undefined
listInquiries(tenantId, limit) -> inquiry[] (at most limit)
transaction(tenantId, async operation(tx)) -> operation result after durable commit
getSessionByTokenHash(sha256Hex) -> valid stored session | undefined
```

The migration creates `tenants`, `memberships`, `inquiries`, `notes`, `audit_events`, and `sessions` in `bookedradar_portal`. Tenant and membership rows default to inactive. It creates no users, credentials, grants, or seed records. The migration fails if the schema already exists rather than silently reusing a possibly incompatible schema; future upgrades need separately reviewed migrations. It runs as one transaction, creating nothing in the existing operational schema.

Membership storage includes `id`, `tenantId`, `userId`, `name`, `role`, `active`. Inquiry storage includes the DTO fields plus `tenantId`. Stored note children additionally include `tenantId` and `inquiryId`, checked before serialization. Composite foreign keys bind inquiries, assignees, notes/authors, audit actors, and session membership/user identities to the same tenant. The runtime adapter does not expose inserts or edits for tenants, memberships, sessions, source/contact fields, provider records, or financial data.

Read SQL uses fixed column lists and parameterized tenant/object predicates. Inquiry reads aggregate bounded note children in the same SQL statement, preserving a consistent read snapshot. Lists fetch at most the requested 1–100 inquiries; membership and note reads fetch a bounded sentinel beyond the API maximum so oversized records fail closed instead of being silently accepted. Pagination remains pending.

The transaction supplies:

```text
tx.getMember(memberId)
tx.getInquiry(inquiryId)
tx.saveInquiry(nextInquiry)
tx.appendAudit(event)
```

These methods are bound to the transaction's tenant, included in every customer-data predicate. IDs may repeat across tenants. There is no reliance on database row-level security, and this migration does not enable RLS. A least-privileged production database role with narrowly reviewed grants still needs provisioning; the migration deliberately does not create persistent access.

The adapter starts a `READ COMMITTED` transaction, locks accessed membership/tenant rows `FOR SHARE`, and acquires the inquiry's `FOR UPDATE` lock in a dedicated parent-only statement. It then reads the inquiry plus notes in a separate statement with a fresh snapshot while retaining the parent lock. This avoids combining a post-wait parent version with pre-wait child-note data; every portal note writer must hold that parent lock. Version comparison is followed by a tenant/object/version compare-and-swap update. The locks serialize concurrent writes and membership/assignee changes; PostgreSQL documents the behavior of [row-level locks](https://www.postgresql.org/docs/18/explicit-locking.html) and [Read Committed locking reads](https://www.postgresql.org/docs/18/transaction-iso.html#XACT-READ-COMMITTED). Transaction-local lock/statement timeouts bound blocked queries.

The adapter accepts at most one workflow save and matching audit per inquiry per transaction. It independently checks append-only notes, read-only source fields, valid transitions, active operator assignees/authors, version increments and matching audit identities/fields/versions. A save without its matching audit rolls back. A database failure, constraint violation or audit failure rolls back both workflow and note writes. Transactions return only after a `COMMIT` command is confirmed; unexpected rollback/connection failures discard the connection. An ambiguous commit/network outcome must be reconciled by rereading the inquiry; no automatic mutation replay is performed.

These are implemented guarantees to be verified against the target database, not claims of a completed production test. The guarded integration suite exercises real PostgreSQL concurrency, constraints and rollback; its actual CI result must be reviewed before launch. The in-memory suite alone proves only application behavior.

`saveInquiry` persists only portal workflow fields (`status`, `assigneeId`, `notes`, `version`, `updatedAt`) to a dedicated portal-owned table/projection. Source identity/contact fields remain read-only. Even if a source row contains additional metadata, it must never overwrite provider dispatch state, booking state, revenue, or integration records. Source synchronization and mapping are a separate pending design. Do not map `closed` to a booked/won revenue event.

Audit events contain only generated event/request IDs, tenant/inquiry/actor/user IDs, action (`inquiry.updated` or `inquiry.note_added`), changed field names, prior/new version, and timestamp. No note text, contact details, credentials, raw request, or raw provider response is included. Audits need restricted operator access and retention policy; there is no customer audit export endpoint in this scaffold.

## Activation approval still required

Before any real customer access, obtain explicit approval for:

1. Choose the customer identity provider and verified-login/onboarding flow, including allowed tenants, membership administration, account recovery, session lifetimes, and logout/revocation. This resolver does not substitute for provider verification. Registering OAuth clients, credentials, or persistent grants requires separate action-time authorization; none have been created.
2. Approve the real source-to-portal mapping, allowed customer fields, target PostgreSQL database, this isolated schema/migration and rollback plan, runtime role permissions, and audit retention/access. Implement the source projector/importer and validate source/customer linkage. Authorization must cover real-data connections/transfers and any persistent database access; none are configured here.
3. The target hosting environment/domain, exact trusted HTTPS origin, session-cookie configuration, and mounting/deploying the reviewed portal routes. This candidate does not authorize publication or deployment.

Then wire and verify the provided adapters plus the remaining identity/source/hosting controls in an isolated staging environment, run real database concurrency/rollback tests and end-to-end customer session/expiry/logout/revocation tests with two distinct tenants, and obtain launch approval. Keep customer access disabled until those checks pass. No substitute shared admin token, development session, mock sign-in, or synthetic test store is an activation option.

## Verification

From the supplied candidate directory:

```sh
npm run check --prefix customer-portal
node --test customer-portal/test/*.test.mjs
```

The suite covers default-deny, unauthenticated/expired/wrong-membership sessions, forged selectors, tenant/object and linked-record isolation, minimal DTOs, assignee eligibility, read-only roles, status transitions, bounded notes and bodies, unknown fields, exact origin/CSRF checks, optimistic/concurrent updates, transaction-time membership revocation, atomic audit rollback, error sanitization, and the real Node HTTP adapter. It uses synthetic data and loopback HTTP only.


### Disposable PostgreSQL verification

`test/postgres.integration.mjs` is intentionally excluded from the ordinary unit-test glob and fails immediately unless explicitly given a disposable environment. It requires PostgreSQL 18+, an actual database name matching `*_portal_test` with no `prod`/`production`/`live` substring, a loopback host, no connection-string query overrides, and `PORTAL_TEST_ACK=disposable`. It checks `current_database()` before mutation and cleanup. There is no production-URL fallback.

The suite creates a fresh random `bookedradar_portal_test_<12 hex digits>` schema by applying the migration with that isolated name. Cleanup drops only that exact generated schema after reverifying the disposable database; it never drops a database, the default portal schema, an existing operational schema, or unrelated data. Migration failure is tested with a deliberate rollback, including verification that the failed schema is absent and the connection is healthy. Test fixtures are synthetic; session-token fixtures are known test-only values.

After installing the repository's pinned existing dependencies into the disposable CI environment:

```sh
PORTAL_TEST_ACK=disposable \
PORTAL_TEST_DATABASE_URL='postgresql://test_user:disposable_ci_only@127.0.0.1:5432/bookedradar_portal_test' \
node --test customer-portal/test/postgres.integration.mjs
```

The suite covers normalized migration and rollback cleanup, same-ID tenant isolation, composite foreign keys, session hash/expiry/revocation, inactive membership/tenant rejection, durable updates/notes/audits, concurrent/stale writes, a lock-graph-synchronized blocked note writer that must return both committed notes with the new version, audit-failure rollback, missing-audit rollback, membership revocation locking, read-only membership, CSRF, status transitions, note immutability, and read-only source fields. The PostgreSQL 18 CI job subsequently passed 15/15 tests at head `e0ecbb864edc685dbbc561ee0b994b72f65c3605`; see [QA evidence](qa/README.md). This verifies the disposable synthetic integration only. No live customer database connection was made.
