# Recovery source projection: inactive candidate

`server/source-projection.mjs` is a pure mapping and merge-plan module. It has no imports, reads, writes, listeners, database connection, route registration, scheduler, credentials, or deployment behavior. Its tests use synthetic objects only. It does not call the existing recovery engine or expose a recovery snapshot to a browser.

## Verified code baseline

Repository: `allenrandy74-dev/Bookedradar-platform-`, commit `dd3adec8c24799f4be2951263e28677cf3f28669`. The files below were read through the authorized GitHub connector. No real source records were read or changed.

- [RecoveryEngine contact identity](https://github.com/allenrandy74-dev/Bookedradar-platform-/blob/dd3adec8c24799f4be2951263e28677cf3f28669/src/recovery/engine.js#L10-L25): raw identity precedence is event `contactKey`, embedded `externalId`, phone, email, then a generated anonymous UUID. The engine adds the tenant prefix unless already present.
- [RecoveryEngine opportunity creation](https://github.com/allenrandy74-dev/Bookedradar-platform-/blob/dd3adec8c24799f4be2951263e28677cf3f28669/src/recovery/engine.js#L342-L363): current contact ownership is explicitly stamped with `tenantId`/`contactKey`; the opportunity stores `tenantId`, `type`, `sourceEventId`, `contactKey`, `source`, `serviceType`, `urgency`, estimated value, and metadata. The persisted source is the event's source or its type.
- [RecoveryStore contact and opportunity methods](https://github.com/allenrandy74-dev/Bookedradar-platform-/blob/dd3adec8c24799f4be2951263e28677cf3f28669/src/recovery/store.js#L203-L263): contacts support `name`, `firstName`, and `lastName`; new opportunities get generated IDs and persistence timestamps; ownership fields are immutable on updates. The JSON getters themselves are not tenant-parameterized.
- [PostgresRecoveryStore read path](https://github.com/allenrandy74-dev/Bookedradar-platform-/blob/dd3adec8c24799f4be2951263e28677cf3f28669/src/postgres-recovery-store.js#L18-L60): tenant-bound reads use `WHERE tenant_id=$1`, but load all five recovery payload collections and event keys into a memory view. Even its individual getter wrappers use that read path. The optional null tenant in the lower-level export reader is not a customer authorization mechanism.
- [Voice capture updates](https://github.com/allenrandy74-dev/Bookedradar-platform-/blob/dd3adec8c24799f4be2951263e28677cf3f28669/server.js#L887-L946): current contact details and `serviceType` may be updated after the original receipt. Metadata includes address, city, preferred window, and unstructured notes, none copied by this adapter.
- [Call history](https://github.com/allenrandy74-dev/Bookedradar-platform-/blob/dd3adec8c24799f4be2951263e28677cf3f28669/src/call-history.js): a separate store contains transcript, masked caller/dialed values, milestones, lead summaries and transfers. [Call finalization](https://github.com/allenrandy74-dev/Bookedradar-platform-/blob/dd3adec8c24799f4be2951263e28677cf3f28669/server.js#L1370-L1388) masks the lead-summary callback. A masked callback is not an authoritative full contact value. No call-history join or transcript export is implemented.
- [Customer-results scope](https://github.com/allenrandy74-dev/Bookedradar-platform-/blob/dd3adec8c24799f4be2951263e28677cf3f28669/src/customer-results-scope.js): only explicit persisted Boolean synthetic markers classify records. Mixed synthetic/real lineage is quarantined for reporting; unmarked history remains unverified. [RadarProof](https://github.com/allenrandy74-dev/Bookedradar-platform-/blob/dd3adec8c24799f4be2951263e28677cf3f28669/src/recovery/radarproof.js) separates estimates from explicit confirmed revenue. This adapter calculates and exports no result or revenue figures.

The partial local checkout has no `.agents/skills` or `AGENTS.md`. The existing root package scripts were inspected from the same commit; this module is checked with the isolated portal suite, not the full original application test suite.

## Input contract and authorization

`projectRecoveryInquiry({ tenantId, opportunity, contact, sourceEvent })` expects three plain, coherently read source records selected by an approved server-side reader. The `tenantId` argument must come from trusted server configuration or a validated customer-session membership, never from a customer-selected header/query. Passing a tenant string is not proof of access.

The reader must select a bounded, tenant-owned opportunity and its exact contact/source event. The mapper requires all three records to carry exactly that tenant, checks the contact key's tenant namespace, and checks:

- `opportunity.contactKey === contact.contactKey`
- `opportunity.sourceEventId === sourceEvent.id`
- `opportunity.type === sourceEvent.type`
- An optional source-event `opportunityId` matches the opportunity
- An embedded source contact's tenant matches, if provided
- The source receipt's creation-time identity, following the engine's precedence, resolves to the linked contact key. An otherwise identity-free receipt requires the engine's anonymous UUID key form. Later contact phone/email changes are allowed because the stable contact key remains the link.
- An embedded `contact.contactKey`, if present in the receipt, cannot contradict that link even though the engine does not use it as its creation-time selector

Reserved recipient-suppression contacts are rejected. Missing/pruned contacts or events, absent ownership, conflicting links, malformed IDs, accessors, oversized text, invalid timestamps, and explicit test markers fail with stable error codes. Errors contain no raw values. The function does not call `toString`, `toJSON`, getters, or serialize/spread a source object; only fixed properties are read. A caller must still pass inert parsed data rather than executable proxies.

Legacy records without explicit ownership are intentionally rejected here. A future tenant-scoped database reader may establish an event's legacy ownership from the actual SQL tenant column, as the existing Postgres store does, but must first reject any payload/column conflict. This mapper must not infer legacy ownership from names, contact details, a selected tenant, or a globally fetched snapshot.

The shared administrator bearer token in `src/auth.js` does not establish an individual customer or membership. This module supplies no login/authentication shortcut and is not a customer API endpoint.

## Field mapping

| Inquiry source column | Verified source | Policy |
| --- | --- | --- |
| `id` | `opportunity.id` | Stable opportunity identity; must fit portal ID rules. Dedicated portal table is scoped by tenant and ID. |
| `tenantId` | Trusted scope, matching all source records | Internal persistence field; the customer DTO excludes it. |
| `customerName` | Current `contact.name`; otherwise joined `firstName` and `lastName` | Trim name parts; keep empty if absent. No guessed identity or transcript extraction. |
| `contact.email` | Current `contact.email` | Empty only when absent. Do not use the event's old contact or masked call summary. |
| `contact.phone` | Current `contact.phone` | Same rule; display-only, does not grant consent or authorize a message. |
| `subject` | Current `opportunity.serviceType` | Empty if absent; no generated subject, urgency claim, booking claim or channel label. |
| `summary` | No established, approved summary field | Empty on creation. Preserve an existing portal summary on refresh because this adapter has no authoritative replacement. Never copy arbitrary `metadata.notes`, transcript, or `summary` properties. |
| `source` | Current `opportunity.source` | Required, kept as stored. Do not guess a channel from an arbitrary source string. |
| `receivedAt` | Linked `sourceEvent.occurredAt` | Source occurrence/receipt time, not opportunity persistence time, contact update time, or an invented current time. Accept a valid ISO instant or the engine's numeric epoch-millisecond representation; normalize to UTC. |

The engine-generated `createdAt` is when an opportunity was persisted and is not substituted for a missing receipt. All display values are plain text; the UI must continue using text rendering. Length and control-character violations are rejected instead of silently truncating identities or displaying serialized objects. Null/object/number contact values are not coerced into strings. Field allowlisting limits exposure; it does not prove arbitrary free-form strings are accurate or suitable for every customer audience.

Not projected: contact keys, source-event IDs, full events/contacts/snapshots, provider request or response data, credentials, metadata, transcripts, addresses, urgency, estimated values, confirmed revenue, payment information, consent, opt-out flags, booking IDs, dispatch actions/outcomes, and raw internal notes. The source receipt's contact values are used only to prove linkage; the current contact supplies display values.

## Workflow-preserving refresh plans

`planInquirySourceRefresh({ tenantId, opportunity, contact, sourceEvent, existing, expectedVersion, refreshedAt })` first applies the same mapper and then returns a plan. It performs no persistence.

- `existing: null` plus `expectedVersion: null` creates a proposal with `status: "new"`, no assignee or notes, version 1, and an explicit refresh time. A future writer must use an insert-only operation so an existing record cannot accidentally be reset.
- Existing rows must match both tenant and inquiry ID. Their status, assignee, version, note identities, tenant/inquiry child links, text, and timestamps are validated. Notes are copied field by field; extra metadata is dropped.
- A refresh preserves the existing human status, assignment, note content/IDs/authors/timestamps, and unsupported summary. Recovery `closed`, `engaged`, won/lost or booked states do not set portal workflow status.
- Only `customerName`, `contact.email`, `contact.phone`, `subject`, `source`, and `receivedAt` can change through this mapping. `expectedVersion` must equal the existing version; a changed projection increments it once and records the supplied refresh time. A later human edit must cause the writer's compare-and-swap to fail, requiring a fresh read and replan.
- Identical projections are no-ops: no audit or version bump, and the original update time/semantically equivalent received-time representation are retained. Refreshed time cannot precede the existing update time. Version overflow fails closed.
- The audit proposal has tenant/inquiry IDs, an explicit source-create/source-refresh action, changed field names, prior/new version and time. It contains no contact values, note text, contact keys, metadata, financial data, or service credentials. It is a proposal, not a persisted audit or a customer-member action.
- Missing, excluded, or malformed source records throw before any plan is returned. They never imply deletion, closing, reassignment, restored contact consent, or cancellation/re-enabling of provider actions.

### Exact writer blockers

The current `postgres-store.mjs` and `schema.sql` intentionally do **not** support these plans. Customer `saveInquiry` forbids source-column changes; `appendAudit` and its table accept only human workflow actions, field names and member actors. Do not weaken those paths or invent a customer member to represent ingestion.

A separately approved internal writer needs, before live use:

1. A dedicated service-actor/source-audit design and reviewed schema migration that can represent source-created/source-refreshed events, including an insert's initial version. The current audit table cannot store these events. A separate restricted source-ingestion audit table is preferable to broadening the customer mutation API.
2. A transaction that locks or compare-and-swaps `(tenant_id, id, version)`, persists only the mapper-owned columns plus version/update time, leaves workflow/notes untouched, and atomically records the source audit. Insert collisions, audit failures, or stale versions must roll back. No source-store write method should be invoked.
3. A durable source-link binding to opportunity, contact and origin event, plus source revisions or a consistent source-read/write fence. The existing portal row stores no source-event/contact binding or source checkpoint. The pure plan checks the supplied triple but cannot detect an older yet internally consistent source snapshot or prove its freshness. Portal version checking protects human edits; by itself it does not prevent out-of-order source refreshes.
4. A reviewed tenant-scoped, bounded reader for opportunities and exact linked contacts/events, with a consistent-read boundary and SQL tenant-column/payload identity checks. Existing JSON `snapshot()` can include all tenants; Postgres `snapshot()` is tenant-bound but still loads full recovery collections. Neither is a bounded customer inquiry feed, and no direct source-event lookup/list interface suitable for this integration was found in the inspected stores. Do not expose the snapshot endpoints or invoke a full-export reader with null tenant.
5. Handling for receipts removed by the existing 90-day default event-retention process. Missing events cannot be backfilled from opportunity timestamps or guessed contact identity. Retain already verified projections under a reviewed retention policy, quarantine the refresh, or introduce an explicitly approved provenance source before importing older rows. No retention changes are implemented here.

## Coverage and eligibility limitations

This triple-only mapper excludes `synthetic: true` on the opportunity, source event, or linked contact, including `metadata.synthetic: true`; explicit true wins over false. Checking the contact is a conservative additional gate beyond the existing reporting code's opportunity/event classification: an explicitly marked contact must not leak demo identity into a customer view. Invalid marker types are rejected. Names, telephone numbers, `source` strings and missing flags never establish test/real classification. Unmarked history can be structurally mapped but is **not verified real activity**. No completeness or result-count claim is produced.

The existing reporting code also quarantines opportunities when later synthetic outcomes/actions/attribution contaminate their lineage. Those records are deliberately not inputs to this minimal mapper, so it cannot independently establish that eligibility rule. Before publishing live data, an approved internal reader must determine the intended customer-inquiry eligibility policy and supply eligible rows using complete tenant-scoped lineage checks. Do not claim this mapper is equivalent to `customerResultSnapshot`, and do not add result/revenue metrics to this projection to fill the gap. If an imported row later becomes ineligible, removing or restricting it needs its own reviewed policy; a failed refresh does not automatically remove existing visibility.

This maps only recovery opportunities. It is not a complete inbox of all calls, chat conversations, lead-log entries, ignored events, bookings or CRM contacts. A raw call summary alone cannot satisfy the required opportunity/contact/source receipt contract.

## Verification

From the candidate root:

```sh
node --check customer-portal/server/source-projection.mjs
node --test customer-portal/test/source-projection.test.mjs
```

The focused synthetic suite covers minimal shapes, authoritative versus unsupported fields, actual engine identity precedence, anonymous receipts, missing/malformed sources, all tenant/link mismatches, poison/secret fields, accessors, synthetic markers, text/time validation, immutable inputs, workflow/summary preservation, exact version handling, no-op refresh, no deletion on missing/pruned source, safe audit contents, and an inactive import-free module. It does not establish database writer durability, reader freshness, customer authentication, provider behavior, or production readiness.
