# Remaining mobile QA

Test-only draft for exact main ddcfd415fef2b2f0adf3735198071fc97e2686a6. Product files, production configuration, deployment and customer data are untouched.

The 51 cases cover homepage layout/direct signup-link presence; audit and signup controls, required-field validation, pending double-click suppression, HTTP/network/JSON failure with retained answers, synthetic success and duplicate notices; and both reporting dashboards' mobile failure clearing and recovery. Each runs at 320, 375 and 390 CSS pixels. Screenshots include full pages and audit/signup form sections. Geometry checks supplement human pixel inspection. These are desktop Chromium responsive tests, not physical-device or mobile Safari acceptance.

Only source files whose Git blob and SHA-256 identities match source-manifest.json are served. Playwright routes fulfill all allowlisted requests directly from those bytes or synthetic JSON; they never continue requests or use a real HTTP server. Absolute production API/telemetry URLs in unchanged application scripts are intercepted, never contacted. The browser process runs in the previously used official Playwright 1.63.0 image with Docker --network none. Service workers, downloads, popups and WebSockets are blocked; unrecognized requests fail. Only qa-* session values and fictional QA contact values are used. No production backend, customer record, credential, call, text, payment or signup is created.

Install only the existing committed qa/reporting-browser lock using npm ci --ignore-scripts --no-audit --no-fund. The browser test uses that package and the pinned official image. No package lock, production dependency or existing reporting test is changed.

The initial workflow uploads nothing. After diagnostic tests establish that the harness works, the one authorized evidence upload must be explicitly gated to the exact approved pull request, workflow run number and first attempt. The lossless deduplicated proof ZIP plus outer-container reserve must fit 25 MiB; retention is one day. A new approval is required if the authorized aggregate allowance changes or another paid upload is needed. Test failure is evidence, not permission to relax an assertion. Do not edit production source to get green.

This candidate has passed syntax and independent isolation review. The local attempted run could not launch Chromium because the environment denied a required socket; none of the 51 browser cases has passed locally. Existing exact-main source-level signup/audit/reporting request tests passed 32/32, which does not establish rendered mobile behavior.

Untested by these cases: Quick Start setup form, physical devices/Safari, exhaustive accessibility and keyboard order, navigation history, phone-success submission, streamed JSON body behavior, real backend/provider delivery and deployed-site parity. Existing PR94 evidence covers its own earlier reporting responsive/request-state suite and must not be relabeled as this run.
