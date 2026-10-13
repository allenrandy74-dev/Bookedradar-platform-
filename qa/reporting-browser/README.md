# Isolated reporting browser QA

Recurring regression checks for current reporting source. The workflow covers same-repository PRs targeting main when reporting pages, backend/shared modules, configuration/schema, startup/scripts, tests, dependencies or this QA harness change. Fork PRs remain excluded by the existing job guard. These checks are not release authority.

The workflow runs the current committed public/owner-brief.html and public/radarproof-dashboard.html in Chromium. A test-owned HTTP server binds only to 127.0.0.1 and returns synthetic JSON. Native fetch and Response.json are unchanged. Slow JSON is tested with a flushed response header and an unfinished body, not a replaced networking adapter.

Before navigation, context-wide routing permits only GET of the two exact dashboard paths, favicon, and the two synthetic API paths on that server's exact origin. APIs require a qa- tenant and qa- token. Every other request is aborted and fails teardown. All WebSockets are closed; service workers and downloads are disabled. Guard probes use reserved .invalid domains and a blocked loopback POST, never production. Source pages have no remote assets. The browser test process runs in the official Playwright container with Docker --network none (loopback only), in addition to Chromium background-networking reduction and DNS denial. No production network interface is available during browser tests. Dependency setup and artifact upload occur outside that container; this does not certify all setup-phase runner traffic.

Dependencies are fetched only during the CI setup phase. No production server, secret, credential, external submission, live tenant, cloud preview, or deployment is used. Runner GITHUB_TOKEN is contents:read and checkout does not persist credentials. Tests receive only synthetic session-storage values.

Coverage: both pages' pending clear, HTTP/network/JSON failure and recovery, overlapping requests, delayed JSON, token edits and failed token switches; Owner Brief tenant edits/failure; RadarProof tenant URL navigation/failure and its actual 30-second interval while token edits are unsaved. Rendering checks cover zero versus unavailable, estimates versus confirmed revenue, recovery and synthetic-history warnings, and Transfers initiated wording. Layout checks cover 320/375/390/1440 CSS px, horizontal overflow, card overlap, keyboard order and visible focus. Screenshots supplement geometry assertions. Human pixel inspection is still required for readability and visual overlap not detected by geometry. This is desktop Chromium responsive testing, not physical iPhone, mobile Safari or screen-reader acceptance.

No screenshot baselines are generated or accepted automatically. A red layout check is a finding; do not relax it or edit reporting source to get green without separate review.

Source provenance is checked against the requested PR head and its tracked working-tree files before dependency setup. Evidence records current commit/tree identities and input blob hashes. A later committed product change is allowed; an unexpected commit, staged change or deletion, modified working source, missing required page, or symlinked source file/parent directory is rejected. Expected inputs are discovered from HEAD rather than the mutable index. source-manifest.json is historical PR94 acceptance evidence, not a permanent product-source freeze.

The isolated package pins @playwright/test and the official Microsoft Playwright image to 1.63.0. Local registry access was denied, so no local npm install/browser run was performed. The committed lock is the actual npm-generated output from GitHub Actions run 37078587551 (official npm registry); CI uses npm ci and verifies the lock remains unchanged. No npm lifecycle scripts run.

Run only in an approved isolated environment:
- From repo root: node qa/reporting-browser/verify-source.mjs
- Run node --test qa/reporting-browser/verify-source.test.mjs.
- Run existing npm check/test/simulation and reporting acceptance / request-state cases.
- In qa/reporting-browser: npm ci --ignore-scripts --no-audit --no-fund; npm test

Artifact uploads remain disabled for normal runs and retries. Do not expand recurring retention or storage without a separate budget decision. Test results remain in job logs; generated screenshots are not durably retained on normal runs. The historical one-off authorization below is unchanged.

The owner approved the two foreground fixes and final proof within the existing aggregate 25 MiB / one-day / US$0.01 allowance. Prior artifact 11257927301 (10,298,576 bytes) is preserved. The final lossless ZIP plus a 65,536-byte outer-container reserve must fit the remaining 15,915,824 bytes. Upload is gated to PR94 / workflow run number 7 / first attempt only. Future runs and retries do not upload; no billing settings change. Reports include browser version, dimensions, source hashes, commit/tree identities, network audit and screenshots. Uploaded evidence is synthetic only.

## Public signup/chat candidate coverage

The public-journeys suite targets PR108 frontend behavior. It serves the unchanged
public/signup.html and pilot-signup.js and the two unchanged chat scripts from a
test-owned loopback HTTP server. The chat scripts run inside minimal synthetic
embedding pages with a qa-browser tenant and an explicit loopback API origin;
this does not verify Wix embedding, demo page navigation, hosting or real APIs.
The existing Docker --network none boundary and Playwright context guards apply.
Only exact fixture assets and two exact loopback POST endpoints are allowed, and
both browser routing and the test server reject non-synthetic request bodies.
No production server, provider, account, email or customer data is used.

Authored cases cover native signup validation, email/phone success focus, duplicate
receipt, stalled headers/body, HTTP/JSON/network failures, retained values and
page-local resubmission hold. Both Shadow DOM chat scripts cover named dialogs,
labels/live-log roles, keyboard Close/Escape, draft/history preservation, and late
success/failure after dismissal or focus moving outside. Initial geometry and
synthetic screenshots cover 320/390/1440px. The network-denial probe stays blocked
at routing and must never reach a transport.

The available local browser launch route was denied and is not retried. Syntax
and pure fixture-network policy tests are only preparation evidence, not browser
acceptance. Authorized hosted results must be checked on the exact current PR
head; this workflow candidate must accompany PR108
(or a descendant with its changes); main alone intentionally fails its new
behavioral expectations. Screen-reader announcements, Safari/physical devices,
zoom/reflow and hosted delivery remain separate acceptance gates.
Normal screenshot uploads remain disabled under the existing artifact gate. Packaging is also limited to that historical run so unrelated normal runs cannot fail the obsolete one-off aggregate storage cap. The packager and upload budget/retention remain unchanged.

For the separate stacked review, the workflow also targets the exact PR108 branch
fix/public-intake-chat-accessibility-20261013. This temporary explicit target
allows the QA-only draft diff to run before its product dependency is merged.
Remove that target after PR108 lands and this draft is retargeted to main.

The terminal network-failure case uses an explicit Playwright route abort before
server transport; native fetch is unchanged. The first hosted raw-socket-close
probe observed two POST deliveries and then waited on the second response. That
is retained as an acceptance limit: a lost response after receipt can produce
transport redelivery despite no application retry, and a page-local resubmission
hold is not durable server idempotency. This suite does not certify ambiguous
post-write disconnect handling or hosted backend duplicate reconciliation.
