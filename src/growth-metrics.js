import fs from "node:fs/promises";
import path from "node:path";

const ALLOWED = new Set(["page_view","demo_call_click","proof_pilot_start","proof_pilot_submit"]);
const TRADES = new Set(["hvac","plumbing","electrical","roofing","home_services","unknown"]);

function clean(value, max=80){ return String(value||"").trim().toLowerCase().replace(/[^a-z0-9_-]/g,"").slice(0,max); }

export function normalizeGrowthEvent(input={}) {
  const event=clean(input.event,40);
  if(!ALLOWED.has(event)) return {ok:false,error:"unsupported_event"};
  const trade=TRADES.has(clean(input.trade,40))?clean(input.trade,40):"unknown";
  const source=clean(input.source,80)||"direct";
  const variant=clean(input.variant,40)||"default";
  return {ok:true,event:{event,trade,source,variant}};
}

export class GrowthMetricsStore {
  constructor(filePath){this.filePath=path.resolve(filePath);this.data={counts:{},updatedAt:null};this.loaded=false;this.chain=Promise.resolve();}
  async load(){if(this.loaded)return;await fs.mkdir(path.dirname(this.filePath),{recursive:true});try{this.data=JSON.parse(await fs.readFile(this.filePath,"utf8"));}catch(e){if(e.code!=="ENOENT")throw e;}this.data.counts||={};this.loaded=true;}
  async record(event){await this.load();const key=[event.event,event.trade,event.source,event.variant].join("|");this.data.counts[key]=(this.data.counts[key]||0)+1;this.data.updatedAt=new Date().toISOString();await this.persist();return this.data.counts[key];}
  async persist(){const tmp=this.filePath+".tmp";const body=JSON.stringify(this.data,null,2);this.chain=this.chain.then(async()=>{await fs.writeFile(tmp,body,"utf8");await fs.rename(tmp,this.filePath);});return this.chain;}
  async summary(){await this.load();return structuredClone(this.data);}
}
