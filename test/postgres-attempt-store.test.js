import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresAttemptStore } from '../src/postgres-state-store.js';
import { buildPostgresMigrationManifest, auditPostgresMigrationSnapshot, normalizeMigrationSnapshotForContent } from '../src/postgres-migration-audit.js';
import { importMigrationManifest } from '../src/postgres-runtime.js';
const intent={tenantId:'synthetic',callId:'call',target:'+14095550101',kind:'transfer',fingerprint:'test'};

test('SQL contract only: attempt claim persists once and compares every immutable binding',async()=>{
  let record;
  const store=new PostgresAttemptStore({query:async(sql,values)=>{
    assert.match(sql,/ON CONFLICT \(attempt_key\) DO UPDATE SET payload=existing.payload/);
    assert.doesNotMatch(sql,/interval|received_at|expires/);
    record ||= JSON.parse(values[1]);
    return {rows:[{payload:structuredClone(record)}]};
  }});
  const first=await store.claimAttempt('key',intent);
  assert.equal(first.claimed,true);assert.equal(first.record.status,'pending');
  assert.ok(first.record.claimToken);assert.deepEqual(first.record.identity,intent);
  assert.equal((await store.claimAttempt('key',intent)).claimed,false);
  for(const field of Object.keys(intent)) await assert.rejects(store.claimAttempt('key',{...intent,[field]:'different'}),/attempt_intent_conflict/);
});

test('SQL contract only: finish uses token, pending status and complete identity CAS',async()=>{
  const calls=[];
  const store=new PostgresAttemptStore({query:async(sql,values)=>{calls.push({sql,values});return {rows:[]};}});
  await assert.rejects(store.finishAttempt('key',{...intent,status:'accepted'}),/attempt_claimToken/);
  await assert.rejects(store.finishAttempt('key',{...intent,claimToken:'token',status:'bogus'}),/attempt_status_invalid/);
  assert.equal(calls.length,0);
  await assert.rejects(store.finishAttempt('key',{...intent,claimToken:'stale',status:'accepted'}),/attempt_claim_conflict/);
  assert.match(calls[0].sql,/payload->>'claimToken'=\$2 AND payload->>'status'='pending'/);
  assert.deepEqual(JSON.parse(calls[0].values[3]),{identity:intent});
});

test('SQL contract only: attempt persistence failures propagate without success',async()=>{
  const store=new PostgresAttemptStore({query:async()=>{throw new Error('offline');}});
  await assert.rejects(store.claimAttempt('key',intent),/offline/);
  await assert.rejects(store.finishAttempt('key',{...intent,claimToken:'token',status:'uncertain'}),/offline/);
});

test('migration retains receipt identity/token and rejects invalid or conflicting history',async()=>{
  const record={...intent,identity:intent,key:'key',claimToken:'token',status:'pending',createdAt:'2026-01-01T00:00:00Z'};
  const snapshot={state:{calls:{},processedWebhooks:{},attempts:{key:record}}};
  const manifest=buildPostgresMigrationManifest(snapshot);
  assert.deepEqual(manifest.rows.providerAttempts,[{attemptKey:'key',payload:record}]);
  assert.equal(auditPostgresMigrationSnapshot({state:{attempts:{key:{...record,identity:{...intent,target:'other'}}}}}).ok,false);
  const statements=[];
  const client={query:async(sql)=>{statements.push(sql);return {rows:[]};},release(){}};
  await assert.rejects(importMigrationManifest({connect:async()=>client},manifest),/migration_attempt_receipt_conflict/);
  assert.ok(statements.includes('ROLLBACK'));assert.ok(!statements.includes('COMMIT'));
});

test('migration canonicalizes tenant-scoped event keys without cross-tenant collisions',()=>{
  const events=['a','b'].map(tenantId=>({id:tenantId,tenantId,type:'synthetic',idempotencyKey:'shared',occurredAt:'2026-01-01T00:00:00Z'}));
  const snapshot={recovery:{eventKeyFormat:'tenant_scoped_v1',events,eventKeys:Object.fromEntries(events.map(e=>[JSON.stringify([e.tenantId,'shared']),e.id]))}};
  const manifest=buildPostgresMigrationManifest(snapshot);
  assert.deepEqual(manifest.rows.recoveryEventKeys,[{tenantId:'a',eventKey:'shared',eventId:'a'},{tenantId:'b',eventKey:'shared',eventId:'b'}]);
  const legacy={recovery:{events:[events[0]],eventKeys:{shared:'a'}}};
  assert.deepEqual(normalizeMigrationSnapshotForContent(legacy).snapshot.recovery.eventKeys,{'["a","shared"]':'a'});
});
