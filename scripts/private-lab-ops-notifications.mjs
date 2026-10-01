import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createPostgresPool} from '../src/postgres-runtime.js';
import {validateLabEnvironment,validateExistingLabDatabase} from './private-voice-lab-start.mjs';

export async function ensurePrivateLabOpsNotifications(pool) {
  await validateExistingLabDatabase(pool);
  const schema=await fs.readFile(new URL('../db/postgres-schema.sql',import.meta.url),'utf8');
  const ddl=schema.match(/CREATE TABLE IF NOT EXISTS bookedradar\.ops_notifications \([\s\S]*?CREATE INDEX IF NOT EXISTS ops_notifications_incident_created_idx[\s\S]*?;/)?.[0];
  if(!ddl) throw new Error('private_lab_notification_schema_missing');
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('private_lab_ops_notifications'))");
    await client.query(ddl);
    await client.query('COMMIT');
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  } finally {client.release();}
  return {ok:true,table:'ops_notifications'};
}

async function main(env=process.env) {
  validateLabEnvironment(env);
  if(env.VOICE_ENABLED!=='false') throw new Error('private_lab_disarmed_required');
  const pool=createPostgresPool({connectionString:env.DATABASE_URL});
  try {
    await ensurePrivateLabOpsNotifications(pool);
    console.log(JSON.stringify({event:'private_lab.ops_notifications_schema',ok:true}));
  } finally {await pool.end();}
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(()=>{console.error(JSON.stringify({event:'private_lab.ops_notifications_schema',ok:false}));process.exitCode=1;});
}
