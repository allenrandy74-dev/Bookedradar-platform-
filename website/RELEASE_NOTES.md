# Existing BookedRadar website update — prepared September 25, 2026

Target only: dc96494e-5565-41be-8513-deeeedcf59d7, www.bookedradar.com.

The current published HTML/CSS/JS was preserved before editing. The downloaded instant-site archive was older than production and was used only for its existing wix.config.json binding. Do not create another Wix site.

Changes prepared:
- Quick Start entry point connected to existing form 1738b140-49de-4cde-b966-3dcd5f676cfc; a receipt/next-steps view does not claim automatic provisioning or activation.
- Existing Revenue Leak Audit capture implementation consolidated into its static page. Live HTML did not contain the configured embed.
- Clearly labeled fictional HVAC chat demo; never present the demo tenant as BookedRadar sales staff or real HVAC service. Dispatch remains off.
- Existing Terms identify BookedRadar LLC and explain possible voicemail handoff. Full customer agreement/legal review is still separate.
- Sitemap restored, homepage internal links canonicalized, current published package prices preserved.

Build: `npm run build` (copies the verified static source into the configured `dist` directory). The installed Wix CLI does not expose a `build` command for this static project.
Release after Wix CLI sign-in: `npx @wix/cli@latest release` from this directory.

After release, verify the homepage, audit capture form, Quick Start, terms/privacy, sitemap and chat demo in a browser. Run only controlled synthetic submissions, inspect the corresponding records, and clean up confirmed test records. Do not enable billing or dispatch for acceptance tests. Verify preserved Wix Forms/CRM and existing redirects.

Static preparation/build is not proof of successful live submission or website-origin chat acceptance. Those checks remain pending until release.
