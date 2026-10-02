# Isolated reporting browser QA

Test-only integration of the exact commits in source-manifest.json. Main and PR92 remain unchanged. This draft is not release authority.

The workflow runs actual, byte-preserved public/owner-brief.html and public/radarproof-dashboard.html in Chromium. A test-owned HTTP server binds only to 127.0.0.1 and returns synthetic JSON. Native fetch and Response.json are unchanged. Slow JSON is tested with a flushed response header and an unfinished body, not a replaced networking adapter.

Before navigation, context-wide routing permits only GET of the two exact dashboard paths, favicon, and the two synthetic API paths on that server's exact origin. APIs require a qa- tenant and qa- token. Every other request is aborted and fails teardown. All WebSockets are closed; service workers and downloads are disabled. Guard probes use reserved .invalid domains and a blocked loopback POST, never production. Source pages have no remote assets. The browser test process runs in the official Playwright container with Docker --network none (loopback only), in addition to Chromium background-networking reduction and DNS denial. No production network interface is available during browser tests. Dependency setup and artifact upload occur outside that container; this does not certify all setup-phase runner traffic.

Dependencies are fetched only during the CI setup phase. No production server, secret, credential, external submission, live tenant, cloud preview, or deployment is used. Runner GITHUB_TOKEN is contents:read and checkout does not persist credentials. Tests receive only synthetic session-storage values.

Coverage: both pages' pending clear, HTTP/network/JSON failure and recovery, overlapping requests, delayed JSON, token edits and failed token switches; Owner Brief tenant edits/failure; RadarProof tenant URL navigation/failure and its actual 30-second interval while token edits are unsaved. Rendering checks cover zero versus unavailable, estimates versus confirmed revenue, recovery and synthetic-history warnings, and Transfers initiated wording. Layout checks cover 320/375/390/1440 CSS px, horizontal overflow, card overlap, keyboard order and visible focus. Screenshots supplement geometry assertions. Human pixel inspection is still required for readability and visual overlap not detected by geometry. This is desktop Chromium responsive testing, not physical iPhone, mobile Safari or screen-reader acceptance.

No screenshot baselines are generated or accepted automatically. A red layout check is a finding; do not relax it or edit reporting source to get green without separate review.

The isolated package pins @playwright/test and the official Microsoft Playwright image to 1.63.0. Local registry access was denied, so no local npm install/browser run was performed. CI generates its install lock from the exact package pin; a committed lock must be added after its actual bytes are available, not fabricated. No npm lifecycle scripts run.

Run only in an approved isolated environment:
- From repo root: node qa/reporting-browser/verify-source.mjs
- Run existing npm check/test/simulation and the 20 acceptance / 19 request-state cases.
- In qa/reporting-browser: npm install --ignore-scripts --no-audit --no-fund; npm test

Artifacts, when explicitly authorized, are capped at 25 MiB and retained for one day. Reports include browser version, dimensions, source hashes, commit/tree identities, network audit and screenshots. Uploaded evidence is synthetic only.
