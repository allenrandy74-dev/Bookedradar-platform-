import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPECTED_TABLES, validatePostgresReleaseSchema, verifyPostgresReleaseSchema, runStartupPostgresSchemaInspection } from '../src/postgres-schema-inspection.js';
const index = columns => ({columns,unique:true,valid:true,ready:true,immediate:true,partial:false,expression:false});
function fixture() {
 const tables=Object.fromEntries(EXPECTED_TABLES.map(n=>[n,{columns:[],indexes:[],checks:[]}]));
 tables.provider_attempt_receipts={columns:[{name:'attempt_key',type:'text',nullable:false},{name:'payload',type:'jsonb',nullable:false}],indexes:[index(['attempt_key'])],checks:[{validated:true,expression:"(jsonb_typeof(payload) = 'object'::text)"}]};
 tables.recovery_events={columns:[{name:'tenant_id',type:'text',nullable:true},{name:'idempotency_key',type:'text',nullable:true}],indexes:[index(['tenant_id','idempotency_key'])]};
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
