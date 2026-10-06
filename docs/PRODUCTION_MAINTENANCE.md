# Production maintenance entrypoint and release boundary

## Status and scope

The container default command is `node startup.mjs`. The package `start` script
still runs `node server.js`, and `render.yaml` is unchanged. Maintenance remains
an explicit opt-in: absent/false mode with no target imports the existing server.
Deploying this image with valid maintenance selectors activates health-only mode;
without them it selects normal application startup. No production deployment,
command/environment setting, database migration, provider operation, new credential,
or permission change is authorized by this code change.

The wrapper imports only the Node HTTP and crypto builtins before choosing its mode. It
does not load dotenv, application configuration, tenants, stores, provider
clients, migration modules, or workers in maintenance mode. It never connects
to PostgreSQL, reads application files, or sends outbound requests. Database
identity below is checked by parsing the existing connection URL in memory.
This is a configured-target check, not proof of database reachability, schema
readiness, writer quiescence, or production authorization.

## Exact selection and identity checks

Maintenance requires all of the following inherited process-environment values:

| Variable | Required value |
| --- | --- |
| `BOOKEDRADAR_MAINTENANCE_MODE` | `true` |
| `BOOKEDRADAR_MAINTENANCE_SERVICE_ID` | `srv-dam8f7bm8hqs73ct778g` |
| `RENDER_SERVICE_ID` | `srv-dam8f7bm8hqs73ct778g` |
| `RENDER_SERVICE_NAME` | `bookedradar-platform` |
| `NODE_ENV` | `production` |
| `BOOKEDRADAR_STORAGE_BACKEND` | `postgres` |

Do not overwrite Render-provided identity variables to make a mismatched
service pass. The ID and configured database identity were observed on both
production instances during the October 5, 2026 read-only preflight. Reverify
the exact destination before a future execution; a renamed/replaced service or
database needs fresh review, not an expanded wildcard or lab exception.

The existing `DATABASE_URL` must use `postgres:` or `postgresql:`, the exact
host `dpg-date5bk9v7es738c22pg-a`, database path
`/bookedradar_postgres_production`, and omitted port or port `5432`. Do not
copy its credentials into tickets, commands, logs, tests, or this document.
Leading/trailing whitespace, control whitespace and URL fragments are rejected.
No query parameters are allowed except a single `sslmode` equal to `disable`,
`prefer`, `require`, `verify-ca`, or `verify-full`. Routing overrides such as
`host`, `dbname`, `port`, `service`, unknown options, and duplicate parameters
fail closed. This parser does not configure or change database TLS.

`PORT` may be omitted for the existing default `5050`, or be a canonical decimal
integer from `1` through `65535`. Empty values, zero, signs, spaces, leading
zeroes, decimal/exponent notation, and out-of-range values fail before listening.
The listener binds `0.0.0.0`, matching the application deployment convention.
There are no entrypoint CLI options; extra arguments fail closed.

`BOOKEDRADAR_MAINTENANCE_MODE` omitted or exactly `false` selects the normal
application only if `BOOKEDRADAR_MAINTENANCE_SERVICE_ID` is absent. An empty,
malformed, differently cased, or whitespace-padded selector fails startup.
A leftover target with maintenance disabled also fails rather than accidentally
serving customers. An invalid identity, database setting or port never falls
back to the normal application. Gate errors are fixed codes without raw URLs,
credentials, or parser/driver messages.

Only values present when the process starts select maintenance. The wrapper
does not read `.env`; adding the selector to a dotenv file does not activate it.
This is a startup choice, not a live toggle or control API. Restart/replacement
would be required to change it and requires separate authorization.

## HTTP contract and shutdown

- `GET /health` returns HTTP 200 with
  `{"status":"maintenance","mode":"maintenance","customerReady":false,"acceptingWork":false}`.
  This is maintenance-process liveness only. It must not be used as evidence
  that customer calls, providers, storage, or a release are ready.
- `HEAD /health` has the same status/headers and no body.
- Every other route/method returns HTTP 503 with `Retry-After: 60`,
  `Cache-Control: no-store`, `customerReady:false`, and `accepted:false`.
  This includes customer routes, webhooks, admin paths, `POST /health`, health
  queries/trailing slashes, WebSocket upgrades, and CONNECT. There is no
  authentication or maintenance-disable endpoint.
- Bodies are discarded without parsing or storage. A provider webhook is
  never acknowledged as processed, received, deduplicated or durably recorded.
  `Expect: 100-continue` gets a final 503 without an interim 100. Malformed HTTP
  can receive the Node parser's 400; it never enters the application.
- Connections close after each response. `SIGTERM` and `SIGINT` close the
  listener and all sockets, including incomplete/upgrade sockets. There is no
  accepted customer work in this process to drain. A one-second hard deadline
  exits nonzero if shutdown is stuck. Listen errors exit nonzero with only
  `maintenance_listen_failed`; normal import failures emit `startup_failed`
  and terminate instead of leaving partially initialized workers running.
- Listening/shutdown logs carry the same per-boot UUID and sanitized Render
  instance ID (`instance_id`), Git commit (`commit_id`) and deploy ID (`deploy_id`)
  when available, with the unique UUID under `boot_id`. Invalid/missing identity
  fields are logged as null. A Render deploy-ID variable is not assumed to exist;
  verify missing metadata through the approved platform evidence. These fields
  appear only in logs, not in public health responses.

503 responses may cause upstream retries or caller failures; provider-specific
retry/retention behavior must be reviewed for the actual window. Maintenance
does not queue, replay, answer, hang up, transfer, or send messages for a call.

## Container command wiring and deployment approval

The reviewed image default is exactly `CMD ["node", "startup.mjs"]`. An empty
Render Docker command override should use that image default; verify the effective
command and exact deployed commit rather than assuming platform behavior. A stale
`node server.js` override bypasses the guard. Do not change protected deployment
settings or deploy solely because this candidate passes tests.

CI exercises the actual default image command without an entrypoint or command
override, using synthetic settings, network isolation and import/transport guards.
Normal pass-through uses a substituted server module to prove selection and unchanged
environment without provider/database startup; it is not live readiness evidence.
Deployment, original-instance retirement, ingress pause and actual-target checks
remain separately controlled steps. Retain the precise approved commit identity.

For the approved maintenance start, retain the original application environment
and add only the explicit selector and target above. Do not turn off or rewrite
voice, fallback transfer, companion SMS, operations alerts, billing, dispatch,
tenant settings, storage arming, or migration-validation settings as a shortcut.
Their configured presence is safe in this branch because their modules do not
load. Credentials remain in their existing authorized service configuration.

For an approved return to the normal application on the same entrypoint, remove
both maintenance variables (or set the mode exactly `false` and remove the
target). The wrapper dynamically imports the actual `./server.js` and passes
the unchanged environment to it. Existing schema, migration, source-fingerprint,
provider, entitlement, and call-safety gates still apply. It performs no implicit
rollback, schema repair, provider rearming, or recovery-file replay.

For an approved shell-managed launch, the exact normal-mode equivalent is:

```sh
unset BOOKEDRADAR_MAINTENANCE_MODE BOOKEDRADAR_MAINTENANCE_SERVICE_ID
exec node startup.mjs
```

For the Render-managed environment, remove **both** variable entries through
the approved service-configuration procedure and retain the effective command
`node startup.mjs`. A shell `unset` does not persistently edit Render settings.
Disabling/unsetting only the mode while leaving the target will intentionally
exit with `maintenance_target_without_mode`; it will not resume the application.

## Window, drain, verification and recovery prerequisites

### Normal-application shutdown evidence

The normal server's process-owned ledger tracks admitted incoming calls and
explicitly registered asynchronous work: WebSocket messages, greeting fallback,
milestone writes, call finalization, application/reconciliation/billing/warm-
transfer routes, automatic dispatch and operations-alert checks. Provider and
persistence promises that lose transfer/SMS timeout races remain tracked until
the original promises settle. Sideband close waits for the per-call pending
message/fallback work before writing the final call summary.

New work producers and mutating routes must opt into the tracked helper; the
ledger is not automatic instrumentation of every promise or Express handler.
Static-file and read-only onboarding routes are not ledger-owned store work.
Duplicate incoming events for a still-active call are rejected with 503 rather
than being falsely acknowledged before admission has been saved.

Shutdown stops registered periodic producers and closes HTTP admission. The
existing referenced 25,000 ms deadline covers both owned-work settlement and
resource cleanup, including closing the PostgreSQL pool. The timeout path emits
`server.drain_timeout` and exits 1 without starting another unbounded cleanup
wait. Inspect each instance/boot's final event and fields:

- `server.drain_complete`: owned work settled, HTTP closed and required cleanup
  completed; `cleanup_complete` records resource-cleanup completion.
- `server.drain_failed`: inspect `failed_work`, `owned_work_settled`,
  `cleanup_complete` and `failure_scope`. The failure counter covers the whole
  process lifetime; a historical settled failure can produce this event even
  when no owned work remains. It is different from a pending-work timeout and
  still requires diagnosis before claiming a clean release.
- `server.drain_timeout`: the deadline expired. Active/pending counts and
  cleanup state describe the remaining local uncertainty; there is no clean
  drain claim. Escalate the exact interruption and recovery risk.

Neither zero active calls nor `server.drain_complete` proves that external
transferred call legs ended, other instances/jobs stopped, or uncertain provider
effects were reconciled. Those require independent evidence and approval. The
ledger improves honest shutdown reporting; it cannot replace an admission-pause
mechanism, provider checks or cross-process writer verification.

### Approved-window checklist

The wrapper does not pause admissions in old instances. A replacement deployment
can coexist with old writers, and a healthy maintenance instance proves nothing
about retirement of its predecessors. Before a separately approved migration:

1. Pin the exact reviewed code, SQL and command wiring, verify the service and
   database again, and capture original nonsecret runtime settings. Confirm
   automatic deployment state through an authorized path.
2. Obtain approval for the concrete maintenance interval and call-admission/
   drain method. Stop new admissions through a reviewed existing mechanism,
   verify both live instances have drained, and account for independent jobs
   and writers. If there is no supported admission pause, stop and resolve that
   blocker or explicitly disclose/obtain approval for the interruption risk.
   Do not invent a control endpoint, reroute providers, or treat a historical
   zero-active-call snapshot as present-time proof.
3. Start the approved maintenance processes and verify both instances run the
   pinned entrypoint/mode and that all predecessor writers have retired. Inspect
   the full health JSON, not only status 200. Confirm representative work routes
   reject with 503 using synthetic requests that cannot trigger provider work.
   Listener readiness cannot establish database quiescence; verify it separately.
4. Take the separately approved final frozen native recovery copy and verify
   restoration into the approved isolated destination. A preparation backup or
   platform JSON projection is not the final complete rollback point. Preserve
   all application/operational tables, migration provenance, all three observed
   production sequences, permanent attempt receipts and uncertain work.
5. Execute only the separately approved exact schema transaction and read-only
   readiness checks. Resolve an uncertain commit before any retry. Keep writers
   and admissions stopped while validating data, sequence and release evidence.
6. Only after those checks and approval, start normal mode with the original
   runtime settings and verify each instance's identity and application readiness.
   Reopen admissions only through the reviewed mechanism. Separately verify the
   existing fallback and delayed companion-SMS behavior; maintenance tests do
   not establish live-provider acceptance.

Do not promise zero downtime. The existing call-drain deadline can interrupt
long calls when instances are replaced. A 200 maintenance liveness response or
all ended historical call rows cannot remove that risk.

On a failed gate, keep work paused and diagnose the fixed error code. Do not
clear receipts/history, broaden identity checks, disable storage safeguards,
start the old server directly, or retry uncertain provider effects to recover
availability. Prefer a forward fix under maintenance. Code-only rollback can
ignore permanent provider fences or tenant-scoped idempotency, and restoring a
pre-upgrade backup after reopening can erase accepted work. Any recovery needs
an explicitly reviewed compatible code/schema/data pair and reconciliation of
effects after the backup. See `POSTGRES_RELEASE_READINESS.md`.

## Local verification

From the repository root, on the supported Node version:

```sh
npm run check
node --test test/maintenance-startup.test.mjs
```

The standalone test requires no installed packages, database, provider account,
application configuration or credentials. It copies only the entrypoint and
test guards into a temporary directory. The import hook rejects all imports
except the entrypoint, `node:http` and `node:crypto`; normal-path tests explicitly intercept
the exact `./server.js` import with a test-only module to verify environment
passthrough. A per-child transport preload rejects every outbound socket, HTTP,
HTTPS, TLS, HTTP/2, DNS, UDP and fetch operation while allowing the listener.
The numeric `0.0.0.0` bind lookup is emulated locally without a DNS request.
In maintenance subprocesses the preload also rejects application intervals and
records application timeouts, allowing only the documented one-second shutdown
deadline. Tests establish no application timer before shutdown. Node HTTP's
internal connection/request timers remain available.
All test requests are loopback requests from the test harness. An independent
guard self-test proves outbound socket/HTTP/fetch rejection.

The suite covers dependency-free maintenance startup, poison application flags,
wrong/missing identities, malformed selectors/URLs/ports, forbidden imports,
normal selection/passthrough, 503 routes/methods/upgrades/Expect behavior,
malformed HTTP, both shutdown signals, listen collision, sanitized import errors,
and the approved Docker entrypoint with unchanged npm/Render configuration. It is not a full normal-app
startup or proof of production drain, database migration, or provider behavior.

`npm run test:maintenance` invokes this standalone test, and `npm test` runs it
after the normal `test/*.test.js` suite so repository CI does not omit it. When
the ordinary suite uses an external no-subprocess guard, run the two suites
separately; do not expand that guard's network privileges. The maintenance-image
CI job additionally tests the actual image default CMD with synthetic settings
and no external network, including malformed-mode rejection and normal selection.
