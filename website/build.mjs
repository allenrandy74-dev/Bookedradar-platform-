import {cp,mkdir} from "node:fs/promises";
await mkdir("dist",{recursive:true});
await cp("src","dist",{recursive:true});
// Wix reserves sitemap.xml; retain it and also provide a non-reserved feed.
await cp("src/sitemap.xml","dist/sitemap-index.xml");
console.log("Existing BookedRadar static site built into dist");
