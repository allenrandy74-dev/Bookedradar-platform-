import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url));
const files=new Set(['index.html','styles.css','app.mjs','model.mjs','fixtures.mjs']);
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8'};
const port=Number(process.env.PORT||4178);
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const file=url.pathname==='/'?'index.html':url.pathname.slice(1);
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  if(!['GET','HEAD'].includes(req.method)||!files.has(file)){res.writeHead(404);return res.end('Not found');}
  try{const data=await readFile(path.join(root,file));res.setHeader('Content-Type',types[path.extname(file)]);res.writeHead(200);res.end(req.method==='HEAD'?undefined:data);}catch{res.writeHead(500);res.end('Preview unavailable');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Synthetic-only preview: http://127.0.0.1:${port}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
