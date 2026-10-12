// Explicit administrative entrypoint only. Never imported by the normal runtime/router.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { seedNewStagingSchema } from './staging-synthetic-seed.mjs';
import { assertStagingConfig, guardStagingPool } from './staging-config.mjs';
import { assertStagingSchemaReady, stagingCatalogFingerprint, STAGING_MIGRATION_DIGEST } from './staging-schema-readiness.mjs';
export { assertStagingSchemaReady } from './staging-schema-readiness.mjs';
export async function setupStagingSchema({config,pool}={}){
  assertStagingConfig(config);
  const original=await readFile(new URL('./schema.sql',import.meta.url),'utf8');
  const auth=await readFile(new URL('./schema.staging.sql',import.meta.url),'utf8');
  if(createHash('sha256').update(original+'\n'+auth).digest('hex')!==STAGING_MIGRATION_DIGEST)throw new Error('staging_migration_source_mismatch');
  const db=guardStagingPool(pool,config),client=await db.connect();let broken=false,committing=false;
  try{
    await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='10s'");await client.query("SET LOCAL statement_timeout='30s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('bookedradar_portal_staging_schema_v1',0))");
    const exists=(await client.query('SELECT 1 FROM pg_namespace WHERE nspname=$1',[config.schema])).rowCount>0;
    if(!exists){
      const base=original.replace(/^BEGIN;\s*$/m,'').replace(/^COMMIT;\s*$/m,'').replaceAll('bookedradar_portal',config.schema);
      await client.query(base);await client.query(auth);
      await seedNewStagingSchema(client);
      const catalog=await stagingCatalogFingerprint(client,config);
      await client.query('INSERT INTO bookedradar_portal_staging.schema_version (version,origin,client_id,site_id,migration_digest,catalog_digest) VALUES (1,$1,$2,$3,$4,$5)',[config.origin,config.wixClientId,config.wixSiteId,STAGING_MIGRATION_DIGEST,catalog]);
    }
    // An existing schema is verified, never repaired, migrated, reseeded or adopted.
    const facade={query:client.query.bind(client),connect:async()=>{throw new Error('unexpected_nested_connection');}};
    await assertStagingSchemaReady({config,pool:facade});
    committing=true;if((await client.query('COMMIT')).command!=='COMMIT')throw new Error('staging_schema_not_committed');
    return {ok:true,schema:config.schema,version:1,created:!exists};
  }catch(error){if(committing)broken=true;try{await client.query('ROLLBACK');}catch{broken=true;}throw error;}
  finally{client.release(broken);}
}
