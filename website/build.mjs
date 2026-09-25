import {cp,mkdir} from "node:fs/promises";
await mkdir("dist",{recursive:true});
await cp("src","dist",{recursive:true});
console.log("Existing BookedRadar static site built into dist");
