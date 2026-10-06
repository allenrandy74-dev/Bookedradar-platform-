import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { readRecovery } from './postgres-recovery-store.js';

export async function readPostgresSnapshot(client) {
  // Platform JSON has no representation for incident history. Refuse to make
  // an incomplete export/rollback appear complete; use an all-table backup.
  const ops = await client.query('SELECT EXISTS (SELECT 1 FROM bookedradar.ops_incidents) AS has_ops_state');
  if (ops.rows[0]?.has_ops_state !== false) throw new Error('postgres_platform_export_requires_all_table_backup_for_ops_state');
  const read = async sql => (await client.query(sql)).rows;
  const map = (rows,key) => Object.fromEntries(rows.map(r=>[r[key],r.payload]));
  const calls=await read('SELECT call_id,payload FROM bookedradar.voice_calls ORDER BY call_id');
  const turns=await read('SELECT call_id,sequence_no,speaker,item_id,occurred_at,text_content FROM bookedradar.call_turns ORDER BY call_id,sequence_no');
  const byCall=new Map();
  for (const row of turns) { if (!byCall.has(row.call_id)) byCall.set(row.call_id,[]); byCall.get(row.call_id).push(row); }
  for (const call of calls) {
    const items=byCall.get(call.call_id) || [];
    const transcript=call.payload.transcript || [];
    if (items.length!==transcript.length || items.some((r,i)=>r.sequence_no!==i || r.speaker!==transcript[i].speaker || r.text_content!==transcript[i].text || (r.item_id || '')!==(transcript[i].itemId || '') || (r.occurred_at ? new Date(r.occurred_at).toISOString() : null)!==(transcript[i].at ? new Date(transcript[i].at).toISOString() : null))) throw new Error('transcript_reconciliation_failed');
  }
  const growth=await read('SELECT metric_key,metric_count::text AS count,updated_at FROM bookedradar.growth_metrics ORDER BY metric_key');
  const counts={}; let updatedAt=null;
  for (const r of growth) { const n=Number(r.count); if (!Number.isSafeInteger(n)) throw new Error('metric_precision_limit'); counts[r.metric_key]=n; const at=r.updated_at ? new Date(r.updated_at).toISOString() : null; if (at && (!updatedAt || at>updatedAt)) updatedAt=at; }
  const billing=await read('SELECT mode,payload FROM bookedradar.billing_state ORDER BY mode');
  const attempts=map(await read('SELECT attempt_key,payload FROM bookedradar.provider_attempt_receipts ORDER BY attempt_key'),'attempt_key');
  return {
    state:{ ...(Object.keys(attempts).length ? {attempts} : {}), processedWebhooks:Object.fromEntries((await read('SELECT webhook_id,received_at FROM bookedradar.webhook_receipts')).map(r=>[r.webhook_id,new Date(r.received_at).getTime()])),calls:map(await read('SELECT call_id,payload FROM bookedradar.call_control_state'),'call_id') },
    callHistory:{ calls:map(calls,'call_id') },
    leads:(await read('SELECT payload FROM bookedradar.lead_captures ORDER BY lead_id')).map(r=>r.payload),
    recovery:await readRecovery(client),
    webChat:{ sessions:map(await read('SELECT session_id,payload FROM bookedradar.web_chat_sessions'),'session_id') },
    transfers:{
      processedWebhooks:Object.fromEntries((await read('SELECT webhook_id,received_at FROM bookedradar.transfer_webhook_receipts ORDER BY webhook_id')).map(r=>[r.webhook_id,new Date(r.received_at).getTime()])),
      calls:map(await read('SELECT transfer_id,payload FROM bookedradar.transfer_records'),'transfer_id')
    },
    growthMetrics:{ counts,updatedAt },
    billingTest:billing.find(r=>r.mode==='test')?.payload || null,
    billingLive:billing.find(r=>r.mode==='live')?.payload || null,
  };
}

export async function exportPostgresPlatform(pool, root, { writersQuiesced=false } = {}) {
  if (!writersQuiesced) throw new Error('writers_must_be_quiesced');
  if (typeof root!=='string' || !root.trim()) throw new Error('destination_root_required');
  const client=await pool.connect(); let snapshot;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    snapshot=await readPostgresSnapshot(client);
    await client.query('COMMIT');
  } catch (error) { try { await client.query('ROLLBACK'); } catch {} throw error; }
  finally { client.release(); }
  await fs.mkdir(root,{recursive:true,mode:0o700});
  const directory=await fs.mkdtemp(path.join(root,'platform-export-'));
  await fs.chmod(directory,0o700);
  const names={state:'state.json',callHistory:'call-history.json',recovery:'recovery-state.json',webChat:'web-chat.json',transfers:'voice-transfers.json',growthMetrics:'growth-metrics.json',billingTest:'billing-test-state.json',billingLive:'billing-live-state.json'};
  const hashes={};
  for (const [key,name] of [...Object.entries(names),['leads','leads.jsonl']]) {
    if (snapshot[key]===null) continue;
    const body=key==='leads' ? snapshot.leads.map(r=>JSON.stringify(r)+'\n').join('') : JSON.stringify(snapshot[key])+'\n';
    await fs.writeFile(path.join(directory,name),body,{flag:'wx',mode:0o600});
    hashes[name]=crypto.createHash('sha256').update(body).digest('hex');
  }
  await fs.writeFile(path.join(directory,'export-manifest.json'),JSON.stringify({version:1,createdAt:new Date().toISOString(),writersQuiesced:true,hashes},null,2)+'\n',{flag:'wx',mode:0o600});
  return { directory,files:Object.keys(hashes),snapshot };
}
