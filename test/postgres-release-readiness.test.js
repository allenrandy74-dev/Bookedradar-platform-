import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPECTED_TABLES, validatePostgresReleaseSchema, verifyPostgresReleaseSchema, runStartupPostgresSchemaInspection } from '../src/postgres-schema-inspection.js';
const index = columns => ({columns,unique:true,valid:true,ready:true,immediate:true,partial:false,expression:false});
function fixture() {
 const tables=Object.fromEntries(EXPECTED_TABLES.map(n=>[n,{columns:[],indexes:[],checks:[]}]));
 tables.provider_attempt_receipts={columns:[{name:'attempt_key',type:'text',nullable:false},{name:'payload',type:'jsonb',nullable:false}],indexes:[index(['attempt_key'])],checks:[{validated:true,expression:"(jsonb_typeof(payload) = 'object'::text)"}]};
 tables.recovery_events={columns:[{name:'tenant_id',type:'text',nullable:true},{name:'idempotency_key',type:'text',nullable:true}],indexes:[index(['tenant_id','idempotency_key'])]};
 tables.ops_incidents.columns=[{name:'last_notified_at',type:'timestamp with time zone',nullable:true,datetimePrecision:6}];
 tables.ops_notifications={
  columns:[...['notification_id','incident_key','state'].map(name=>({name,type:'text',nullable:false})),
   {name:'created_at',type:'timestamp with time zone',nullable:false,datetimePrecision:6,defaultKind:'transaction_time'},
   {name:'provider_receipt',type:'text',nullable:true},{name:'payload',type:'jsonb',nullable:false}],
  indexes:[index(['notification_id'])],
  foreignKeys:[{validated:true,columns:['incident_key'],referencedSchema:'bookedradar',referencedTable:'ops_incidents',referencedColumns:['incident_key']}],
  checks:[{validated:true,expression:"state = ANY (ARRAY['pending'::text, 'accepted'::text, 'uncertain'::text, 'not_sent'::text])"}],
 };
 return {tables};
}
test('release schema gate validates index semantics and refuses legacy global authority',()=>{
 assert.equal(validatePostgresReleaseSchema(fixture()).ok,true);
 const deferred=fixture(); deferred.tables.provider_attempt_receipts.indexes.push({...index(['attempt_key']),immediate:false}); assert.ok(validatePostgresReleaseSchema(deferred).issues.includes('provider_attempt_receipts_deferrable_key_unsupported'));
 for(const field of ['valid','ready','immediate']) { const f=fixture(); f.tables.recovery_events.indexes[0][field]=false; assert.equal(validatePostgresReleaseSchema(f).ok,false); }
 for(const field of ['partial','expression']) { const f=fixture(); f.tables.recovery_events.indexes[0][field]=true; assert.equal(validatePostgresReleaseSchema(f).ok,false); }
 const f=fixture();f.tables.recovery_events.indexes.push(index(['idempotency_key']));assert.ok(validatePostgresReleaseSchema(f).issues.includes('recovery_events_legacy_global_unique_key'));
});
test('failed metadata validation never includes driver credentials and releases connection',async()=>{
 const queries=[];let released=false;
 const pool={connect:async()=>({query:async sql=>{queries.push(sql);if(sql==='ROLLBACK')return {rows:[]};throw Error('postgres://user:secret@host/db');},release(){released=true;}})};
 await assert.rejects(verifyPostgresReleaseSchema(pool),error=>error.message.includes('validation_failed')&&!error.message.includes('secret'));
 assert.deepEqual(queries,['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY','ROLLBACK']);assert.equal(released,true);
 const result=await runStartupPostgresSchemaInspection({enabled:true,env:{DATABASE_URL:'synthetic'},createPool:()=>({end:async()=>{}}),inspect:async()=>{throw Error('secret');}});
 assert.equal(result.error,'postgres_schema_inspection_failed');
});

test('notification readiness rejects incompatible fences, defaults, foreign keys and indexes',()=>{
 for(const [table,name] of [['ops_incidents','last_notified_at'],['ops_notifications','created_at']]) {
  for(const precision of [3,null,undefined]) {
   const f=fixture();f.tables[table].columns.find(c=>c.name===name).datetimePrecision=precision;
   assert.equal(validatePostgresReleaseSchema(f).ok,false,`${table} precision ${precision}`);
  }
 }
 const d=fixture();d.tables.ops_notifications.columns.find(c=>c.name==='created_at').defaultKind='unverified';
 assert.equal(validatePostgresReleaseSchema(d).ok,false);
 for(const change of [fk=>{fk.validated=false;},fk=>{fk.referencedSchema='public';},fk=>{fk.referencedTable='other';},fk=>{fk.referencedColumns=['scope_key'];},fk=>{fk.columns=['notification_id'];}]) {
  const f=fixture();change(f.tables.ops_notifications.foreignKeys[0]);assert.equal(validatePostgresReleaseSchema(f).ok,false);
 }
 const missing=fixture();missing.tables.ops_notifications.foreignKeys=[];assert.equal(validatePostgresReleaseSchema(missing).ok,false);
 for(const field of ['valid','ready','immediate','partial','expression']) {
  const f=fixture();f.tables.ops_notifications.indexes[0][field]=['partial','expression'].includes(field);
  assert.equal(validatePostgresReleaseSchema(f).ok,false,field);
 }
});
