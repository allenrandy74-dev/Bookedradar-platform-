# BookedRadar native homepage — published September 27, 2026

Existing Wix site: dc96494e-5565-41be-8513-deeeedcf59d7.
Live URL: https://www.bookedradar.com/

## Release

Randy published the reviewed source from Windows with @wix/cli 1.1.251 release. The CLI reported "Site published on bookedradar.com". The agent then verified the live homepage in the browser.

The agent environment blocks Wix CLI publishing by network policy. Continue using the authorized Windows workflow for future releases.

## Verified live

- New hero and section architecture displayed on the existing domain.
- All five configured telephone destinations present; no calls placed.
- No Founding Partner Pilot wording in the new homepage.
- No desktop horizontal overflow.
- Current package prices preserved; Proof Pilot is distinct from paid continuation.
- Privacy, Terms and Security shortcuts return 200 at their existing policy destinations.
- /pilot and /pilot.html reach the existing backend-hosted Proof Pilot form.
- /sitemap.xml redirects to /sitemap-index.xml; both resolve successfully to valid XML with seven URLs.
- robots.txt, audit.html and radarproof.html return 200.
- Search Console verification tag retained in source and release.
- Randy gave visual approval after being asked to review the phone preview. No independent mobile screenshot or automated mobile viewport review was captured.

## Form and measurement corrections

One synthetic submission created exactly one Wix contact and one linked task, but the former handler displayed an error because growthMetrics was never initialized.

The correction is live: initialize the metrics store, and prevent a measurement failure from invalidating completed CRM capture or releasing the deduplication key. No second live inquiry was submitted.

Validation:
- 222/222 tests pass.
- Isolated handler tests confirm successful capture and duplicate suppression with both working metrics and simulated metrics failure.
- Real local server accepts JSON and native text/plain beacons, rejects malformed/unsupported events, and persists expected counts.
- Live metrics endpoint accepts both formats with 202.
- Native homepage script now sends page views and five trade-demo click events to the supported endpoint. End-to-end browser event count attribution was not independently read back.
- Production health 200; startup fallback_ready true.

## Preservation and rollback

No new Wix site or replacement domain was created. No production phone configuration, credentials, routing, messaging settings, billing settings or customer outreach was changed.

All eight prior Wix redirects remain. Added /privacy, /terms, /security, /proof-pilot and /sitemap.xml destinations.

Prior website source is preserved on branch website/rollback-before-native-homepage-2026-09-27 at 978932573e1bf3514c57455cbdcf98a443989c9e. For a source rollback, download that branch, enter website, run npm run build and npx --yes @wix/cli@1.1.251 release against the existing Wix IDs. This is a source rollback, not a saved Wix release identifier.

Backend live revision: 3dfe0dfa6c95448a00f724d10aa885dce736c7cb.
