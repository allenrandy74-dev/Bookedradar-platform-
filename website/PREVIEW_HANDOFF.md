# BookedRadar native homepage preview

This branch is a draft. It does not modify the live homepage or phone system.

## Windows

1. Download this branch using GitHub **Code > Download ZIP**, then extract the ZIP.
2. Open the extracted `website` folder.
3. Double-click `Preview-Windows.cmd`.
4. If prompted, approve Wix CLI login for the existing BookedRadar account.
5. Copy the preview URL back into the ChatGPT conversation.

The launcher checks the existing site ID, builds the static files, and creates a preview. It never calls `release`. Node.js 22 or newer must be installed. The Wix CLI is pinned to 1.1.251, whose preview command was inspected during preparation.

## Acceptance still required

- Desktop and iPhone-width visual review; no horizontal overflow.
- Every CTA and all five telephone destinations (do not place calls).
- One synthetic Proof Pilot form submission; verify exactly one CRM contact and one linked task, with no customer outreach.
- Pricing against current production commercial settings.
- Policy pages, sitemap, robots, aliases and redirects. Pre-release probes returned 404 for /privacy, /terms, /security, /pilot, /pilot.html and /sitemap.xml; these are unresolved, not verified fixes.
- Verify native homepage funnel measurement. Current form links retain source/variant attribution, but native demo-click recording has not been verified.
- Capture the current Wix release and rollback procedure before publishing.

## Preservation

Only the homepage and its dedicated assets are changed. Existing supporting page sources, forms integration, domain binding, Search Console verification tag and backend/phone code are preserved. Proof Pilot calls to action currently link to the existing backend-hosted form, rather than adding a new cross-origin form.

Repository baseline: `978932573e1bf3514c57455cbdcf98a443989c9e`. This baseline is a source fallback, not confirmation of the exact current Wix release. Release remains blocked until the acceptance checks above pass.
