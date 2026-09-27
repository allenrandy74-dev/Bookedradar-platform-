# BookedRadar native homepage preview

Target existing Wix site: dc96494e-5565-41be-8513-deeeedcf59d7.
The native homepage remains unpublished. Do not create a new site.

## Windows: refresh the preview

1. Download this updated branch using GitHub Code > Download ZIP and extract into a fresh folder.
2. Open the website folder and double-click Preview-Windows.cmd.
3. Return the preview URL for verification. Do not run release yet.
4. Capture the preview at iPhone width (390 CSS pixels) for mobile review.

Node.js 22 or newer is required. The launcher verifies the existing Wix IDs and only builds/previews.

## Verified September 27, 2026

- Desktop hero, live-demo layout, pricing, capped Proof Pilot section and FAQ reviewed in the Wix preview. No desktop horizontal overflow.
- All five phone targets match production configuration. No calls placed.
- Pricing: Answer 149; Recover 497/397 founding; Grow 697/597; Schedule 897/797; Dispatch custom.
- One synthetic form submission created exactly one contact and one task. It showed a false failure due to an uninitialized growthMetrics variable.
- The form correction is deployed. Metrics failures can no longer invalidate completed CRM capture or release its deduplication key.
- Production health returned 200; initialized growth-event endpoint returned 202. Startup fallback_ready remains true.
- 222/222 tests pass. Isolated real-server checks validate JSON and native text/plain beacons, reject malformed/unsupported input, and confirm persisted event counts.
- Isolated form-handler tests verify successful capture and duplicate suppression both with working metrics and with simulated metrics failure. No second live CRM submission was made.
- Live /privacy, /terms and /security resolve to existing policy content.
- Live /pilot and /pilot.html resolve through /proof-pilot to the existing form.
- All eight original Wix redirects preserved. Four missing destination/shortcut redirects added.
- Supporting HTML pages and robots return 200. Search Console verification retained.
- No obsolete Founding Partner Pilot language found in the new homepage or checked supporting pages.

## Latest preview changes

- Native page views and five trade-demo click events now use the existing validated growth endpoint.
- Old /#pilot links retain an alias to the new Proof Pilot section.
- A non-reserved sitemap-index.xml copy is included in the build. Existing sitemap.xml is retained.

## Remaining release gates

- Refresh the Wix preview to include the latest changes; check actual browser-origin beacon delivery.
- Finish CTA destination checks on that revision.
- iPhone-width visual review is still unverified: the agent browser lacks a viewport resize API.
- /sitemap.xml still returns 404. Verify the new /sitemap-index.xml, then resolve the canonical sitemap route and robots reference before release.
- Form success has been verified with isolated handler tests, not another live CRM submission.
- Record the current Wix release/version and confirm rollback before publishing.
- Publish only the existing Wix site, then verify the live homepage and routes.

## Rollback and constraints

Native source baseline: 978932573e1bf3514c57455cbdcf98a443989c9e. This can rebuild the prior website source, but has not been confirmed as the exact previous Wix release.
Backend previous live revision: 978932573e1bf3514c57455cbdcf98a443989c9e.
Backend current live revision: 3dfe0dfa6c95448a00f724d10aa885dce736c7cb.

The backend changes affect the website inquiry/measurement handlers only. No phone configuration, routing, credentials, messaging settings, billing, or customer outreach changed.

Wix CLI release is blocked from the agent environment by network policy. The user successfully generated a preview on Windows. Continue that authorized workflow for preview/release; do not work around the network restriction.
