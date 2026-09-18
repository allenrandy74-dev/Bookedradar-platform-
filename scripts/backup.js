import fs from "node:fs/promises";
import path from "node:path";
const sourceFiles=[process.env.RECOVERY_STATE_FILE||"./data/recovery-state.json",process.env.STATE_FILE||"./data/state.json",process.env.LEADS_FILE||"./data/leads.jsonl"];
const stamp=new Date().toISOString().replaceAll(":","-").replaceAll(".","-");
const destination=path.resolve("./backups",stamp); await fs.mkdir(destination,{recursive:true});
const copied=[];
for(const source of sourceFiles){const absolute=path.resolve(source);try{await fs.access(absolute);const dest=path.join(destination,path.basename(absolute));await fs.copyFile(absolute,dest);copied.push(dest);}catch(e){if(e.code!=="ENOENT")throw e;}}
console.log(JSON.stringify({ok:true,destination,copied,createdAt:new Date().toISOString()},null,2));
