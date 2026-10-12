// Read-only readiness. Does not import a migration file or perform DDL.
import { createHash } from 'node:crypto';
import { assertStagingConfig, guardStagingPool } from './staging-config.mjs';
export const STAGING_MIGRATION_ID='bookedradar-portal-staging-v1';
export const STAGING_MIGRATION_DIGEST='aed0c480284f97405069eb19f8f0e57014e2c2453f1780088a9b85db1e8db8aa';
const TABLES=['audit_events','auth_rate_limits','identity_binding_audit','identity_bindings','inquiries','login_browsers','login_discoveries','memberships','notes','oauth_flows','schema_version','sessions','tenants'];
export async function stagingCatalogFingerprint(db,config){
  assertStagingConfig(config);
  const tables=(await db.query(`SELECT c.relname AS name,c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind IN ('r','p','v','m','f') ORDER BY c.relname`,[config.schema])).rows;
  if(JSON.stringify(tables.map(t=>t.name))!==JSON.stringify(TABLES)||tables.some(t=>t.relkind!=='r'||t.relpersistence!=='p'||t.relrowsecurity||t.relforcerowsecurity))throw new Error('staging_schema_shape_mismatch');
  const columns=(await db.query(`SELECT c.relname AS table_name,a.attname AS name,a.attnum AS position,pg_catalog.format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS not_null,a.attidentity AS identity,a.attgenerated AS generated,pg_catalog.pg_get_expr(d.adbin,d.adrelid) AS default_expression FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname=$1 AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`,[config.schema])).rows;
  const constraints=(await db.query(`SELECT c.relname AS table_name,k.conname AS name,k.contype AS type,k.convalidated AS validated,k.condeferrable AS deferrable,k.condeferred AS deferred,pg_catalog.pg_get_constraintdef(k.oid,false) AS definition FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid=k.conrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 ORDER BY c.relname,k.conname`,[config.schema])).rows;
  const indexes=(await db.query(`SELECT t.relname AS table_name,i.relname AS name,x.indisvalid AS valid,x.indisready AS ready,pg_catalog.pg_get_indexdef(i.oid) AS definition FROM pg_catalog.pg_index x JOIN pg_catalog.pg_class i ON i.oid=x.indexrelid JOIN pg_catalog.pg_class t ON t.oid=x.indrelid JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=$1 ORDER BY t.relname,i.relname`,[config.schema])).rows;
  const extras=(await db.query(`SELECT (SELECT count(*)::int FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1) AS routines,(SELECT count(*)::int FROM pg_catalog.pg_trigger tr JOIN pg_catalog.pg_class c ON c.oid=tr.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND NOT tr.tgisinternal) AS triggers`,[config.schema])).rows[0];
  if(!columns.length||!constraints.length||!indexes.length||constraints.some(c=>!c.validated)||indexes.some(i=>!i.valid||!i.ready)||extras?.routines!==0||extras?.triggers!==0)throw new Error('staging_schema_shape_mismatch');
  return createHash('sha256').update(JSON.stringify({tables,columns,constraints,indexes,extras})).digest('hex');
}
export async function assertStagingSchemaReady({config,pool}={}){
  assertStagingConfig(config);const db=guardStagingPool(pool,config);
  const row=(await db.query('SELECT version,origin,client_id,site_id,migration_digest,catalog_digest FROM bookedradar_portal_staging.schema_version WHERE singleton=true')).rows[0];
  if(row?.version!==1||row.origin!==config.origin||row.client_id!==config.wixClientId||row.site_id!==config.wixSiteId||row.migration_digest!==STAGING_MIGRATION_DIGEST||!/^[a-f0-9]{64}$/.test(row.catalog_digest||''))throw new Error('staging_schema_version_mismatch');
  if(await stagingCatalogFingerprint(db,config)!==row.catalog_digest)throw new Error('staging_schema_shape_mismatch');
  return {ok:true,schema:config.schema,version:1};
}
