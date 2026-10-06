import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMigrationSnapshotForContent, stableHash } from '../src/postgres-migration-audit.js';
function fixture(){return {webChat:{sessions:{}},recovery:{events:[{id:'manual',tenantId:'t'},{id:'regular',tenantId:'t',idempotencyKey:'regular-key'}],opportunities:{},eventKeys:{'manual-explicit-key':'manual','regular-key':'regular'}}};}
test('legacy explicit receipt aliases normalize identically to scoped PostgreSQL export without losing mappings',()=>{
 const source=fixture(),exported=structuredClone(source);
 exported.recovery.eventKeyFormat='tenant_scoped_v1';
 exported.recovery.eventKeys={'["t","manual-explicit-key"]':'manual','["t","regular-key"]':'regular'};
 const a=normalizeMigrationSnapshotForContent(source),b=normalizeMigrationSnapshotForContent(exported);
 assert.equal(stableHash(a.snapshot),stableHash(b.snapshot));
 assert.equal(Object.keys(a.snapshot.recovery.eventKeys).length,2);
 assert.deepEqual(a.normalizations,['recovery.eventKeys:tenant_scoped']);
 assert.deepEqual(b.normalizations,['recovery.eventKeyFormat:remove_format_marker']);
 assert.equal(source.recovery.eventKeys['manual-explicit-key'],'manual');
});
test('source-event opportunity ownership normalizes manual key aliases',()=>{
 const source=fixture();delete source.recovery.events[0].tenantId;
 source.recovery.opportunities={op:{tenantId:'t',sourceEventId:'manual'}};
 assert.equal(normalizeMigrationSnapshotForContent(source).snapshot.recovery.eventKeys['["t","manual-explicit-key"]'],'manual');
});
test('an idempotency key that itself looks scoped remains a literal key and is not decoded',()=>{
 const source=fixture();source.recovery.events[1].idempotencyKey='["literal","key"]';
 source.recovery.eventKeys={'["literal","key"]':'regular'};
 assert.deepEqual(normalizeMigrationSnapshotForContent(source).snapshot.recovery.eventKeys,{'["t","[\\"literal\\",\\"key\\"]"]':'regular'});
});
test('normalization rejects conflicting scoped ownership and different-event aliases',()=>{
 const source=fixture();source.recovery.eventKeyFormat='tenant_scoped_v1';source.recovery.eventKeys={'["foreign","key"]':'regular'};
 assert.throws(()=>normalizeMigrationSnapshotForContent(source),/tenant_conflict/);
 const ambiguous=fixture();ambiguous.recovery.eventKeys={'["t","manual"]':'manual'};
 assert.throws(()=>normalizeMigrationSnapshotForContent(ambiguous),/ambiguous_legacy_alias/);
 const unknown=fixture();unknown.recovery.eventKeyFormat='future';
 assert.throws(()=>normalizeMigrationSnapshotForContent(unknown),/format_unsupported/);
});

test('raw JSON-looking event IDs remain literal receipt identities',()=>{
 const event={id:'["legacy","id"]',tenantId:'t'};
 const result=normalizeMigrationSnapshotForContent({recovery:{events:[event],eventKeys:{[event.id]:event.id}}});
 assert.equal(result.snapshot.recovery.eventKeys[JSON.stringify(['t',event.id])],event.id);
});
