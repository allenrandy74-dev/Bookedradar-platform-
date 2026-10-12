// Explicit operator-only CLI utility. Never imported by runtime or exposed over HTTP.
// Requires separate owner confirmation naming this exact verified fingerprint.
import { pathToFileURL } from 'node:url';
import { assertStagingConfig,guardStagingPool } from './staging-config.mjs';
import { assertStagingSchemaReady } from './staging-schema-readiness.mjs';
import { stagingRuntimeConfig } from './staging-runtime.mjs';
export function ownerBindingCliConfig(env) {
  const config=stagingRuntimeConfig(env);
  if(!config||(env.PORTAL_STAGING_SETUP!==undefined&&env.PORTAL_STAGING_SETUP!=='false'))throw new Error('normal_staging_runtime_gate_required');
  return config;
}
export async function activateStagingOwner({config,pool,fingerprint,confirmationReference}={}){
  assertStagingConfig(config);
  if(!/^[a-f0-9]{64}$/.test(fingerprint||'')||typeof confirmationReference!=='string'||confirmationReference.length<3||confirmationReference.length>200||/[\x00-\x1f\x7f]/.test(confirmationReference))throw new Error('explicit_fingerprint_confirmation_required');
  await assertStagingSchemaReady({config,pool});
  const db=guardStagingPool(pool,config),client=await db.connect();let broken=false,committing=false;
  try{
    await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='5s'");await client.query("SET LOCAL statement_timeout='10s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('bookedradar_portal_staging_owner_binding_v1',0))");
    const discovery=await client.query('SELECT fingerprint FROM bookedradar_portal_staging.login_discoveries WHERE fingerprint=decode($1,\'hex\') AND expires_at>clock_timestamp() FOR UPDATE',[fingerprint]);
    if(discovery.rowCount!==1)throw new Error('fresh_verified_sign_in_required');
    const bindings=(await client.query('SELECT encode(fingerprint,\'hex\') AS fingerprint,tenant_id,member_id,user_id,active FROM bookedradar_portal_staging.identity_bindings FOR UPDATE')).rows;
    if(bindings.some(b=>b.fingerprint!==fingerprint||b.tenant_id!=='portal-staging-demo'||b.member_id!=='owner-pilot'||b.user_id!=='staging-owner-pilot'||!b.active))throw new Error('different_or_revoked_binding_requires_separate_review');
    const member=await client.query(`SELECT m.id FROM bookedradar_portal_staging.memberships m JOIN bookedradar_portal_staging.tenants t ON t.id=m.tenant_id WHERE m.tenant_id='portal-staging-demo' AND m.id='owner-pilot' AND m.user_id='staging-owner-pilot' AND m.role='operator' FOR UPDATE OF m,t`);
    if(member.rowCount!==1)throw new Error('synthetic_owner_membership_missing');
    await client.query("UPDATE bookedradar_portal_staging.tenants SET active=true WHERE id='portal-staging-demo'");
    await client.query("UPDATE bookedradar_portal_staging.memberships SET active=true WHERE tenant_id='portal-staging-demo' AND id='owner-pilot' AND user_id='staging-owner-pilot'");
    await client.query(`INSERT INTO bookedradar_portal_staging.identity_bindings (fingerprint,tenant_id,member_id,user_id,active) VALUES (decode($1,'hex'),'portal-staging-demo','owner-pilot','staging-owner-pilot',true) ON CONFLICT(fingerprint) DO NOTHING`,[fingerprint]);
    await client.query(`INSERT INTO bookedradar_portal_staging.identity_binding_audit (fingerprint,confirmation_reference,action) VALUES (decode($1,'hex'),$2,'owner_pilot_activated') ON CONFLICT(fingerprint) DO NOTHING`,[fingerprint,confirmationReference]);
    await client.query('DELETE FROM bookedradar_portal_staging.login_discoveries WHERE fingerprint=decode($1,\'hex\')',[fingerprint]);
    committing=true;if((await client.query('COMMIT')).command!=='COMMIT')throw new Error('binding_not_committed');
    return {ok:true,tenantId:'portal-staging-demo',memberId:'owner-pilot'};
  }catch(error){if(committing)broken=true;try{await client.query('ROLLBACK');}catch{broken=true;}throw error;}
  finally{client.release(broken);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  let pool;
  try{
    const args=process.argv.slice(2);
    if(args.length!==3||args[0]!=='--activate-owner-pilot')throw new Error('explicit_operator_arguments_required');
    const config=ownerBindingCliConfig(process.env);const {Pool}=await import('pg');
    if(!process.env.DATABASE_URL)throw new Error('existing_lab_database_required');
    pool=new Pool({connectionString:config.connectionString,max:1,connectionTimeoutMillis:5000,application_name:'bookedradar-staging-owner-binding'});
    await activateStagingOwner({config,pool,fingerprint:args[1],confirmationReference:args[2]});
    process.stdout.write('Owner pilot identity activated for the synthetic staging tenant. Sign in again.\n');
  }catch{process.stderr.write('Owner pilot activation failed. No credentials or provider response are printed. Verify explicit approval, fresh fingerprint and lab gates.\n');process.exitCode=1;}
  finally{await pool?.end();}
}
