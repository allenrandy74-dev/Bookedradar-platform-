import test from 'node:test';
import assert from 'node:assert/strict';
import { createPostgresPortalStore } from '../server/postgres-store.mjs';

const at='2026-10-12T12:00:00.000Z';
const raw={tenant_id:'tenant-a',id:'inquiry-a',customer_name:'Synthetic',contact_email:'fixture@example.test',contact_phone:'',subject:'Synthetic request',summary:'',source:'phone',received_at:at,updated_at:at,status:'new',assignee_id:null,version:'1',notes:[]};
const member={tenant_id:'tenant-a',id:'member-a',user_id:'user-a',name:'Synthetic Operator',role:'operator',active:true};
function harness({ mode='required', visible=true, updateVisible=true, noteVisible=true }={}) {
  const calls=[];
  const client={async query(sql,values){
    calls.push({sql,values});
    if(sql.includes('SELECT m.id'))return {rows:[structuredClone(member)]};
    if(sql.includes('SELECT i.id') && sql.includes('FOR UPDATE'))return {rows:[{id:'inquiry-a'}]};
    if(sql.includes('FROM "bookedradar_portal".inquiries i') && sql.startsWith('SELECT'))return {rows:visible?[{...structuredClone(raw),reason_code:'DO_NOT_EXPOSE_REASON',valid_until:at}]:[]};
    if(sql.startsWith('UPDATE'))return {rows:[],rowCount:updateVisible?1:0};
    if(sql.startsWith('INSERT INTO')&&sql.includes('.notes'))return {rows:[],rowCount:noteVisible?1:0};
    return {rows:[],rowCount:1,command:sql==='COMMIT'?'COMMIT':undefined};
  },release(){}};
  const pool={query:client.query,connect:async()=>client};
  return {store:createPostgresPortalStore({pool,sourceVisibility:mode}),calls,pool};
}

test('imported visibility is explicitly required, defaults off and cannot change staging mode',()=>{
  const {pool}=harness();
  for(const sourceVisibility of [null,true,'all','optional'])assert.throws(()=>createPostgresPortalStore({pool,sourceVisibility}),/invalid_source_visibility_mode/);
  assert.throws(()=>createPostgresPortalStore({pool,schema:'bookedradar_portal_staging',sourceVisibility:'required'}),/source_visibility_staging_forbidden/);
  createPostgresPortalStore({pool});
});

test('required-mode list and detail filter source visibility in the same query before limit',async()=>{
  const f=harness();
  const detail=await f.store.getInquiry('tenant-a','inquiry-a');
  await f.store.listInquiries('tenant-a',10);
  for(const call of f.calls){
    assert.match(call.sql,/source_links/);assert.match(call.sql,/source_visibility/);
    assert.match(call.sql,/clock_timestamp\(\)/);assert.match(call.sql,/valid_until/);
    assert.match(call.sql,/i\.tenant_id=\$1/);assert.equal(call.values[0],'tenant-a');
  }
  const list=f.calls[1].sql;
  assert.ok(list.indexOf('.source_visibility')<list.indexOf('ORDER BY i.received_at'));
  assert.doesNotMatch(JSON.stringify(detail),/DO_NOT_EXPOSE_REASON|reason_code|valid_until|source_fingerprint/);
});

test('legacy-mode reads never query visibility metadata',async()=>{
  const f=harness({mode:'off'});
  await f.store.getInquiry('tenant-a','inquiry-a');await f.store.listInquiries('tenant-a',10);
  for(const c of f.calls)assert.doesNotMatch(c.sql,/source_links|source_visibility|valid_until/);
});

test('hidden or unlinked imported records deny detail and transactional read',async()=>{
  const f=harness({visible:false});
  assert.equal(await f.store.getInquiry('tenant-a','inquiry-a'),undefined);
  assert.deepEqual(await f.store.listInquiries('tenant-a'),[]);
  await f.store.transaction('tenant-a',async tx=>assert.equal(await tx.getInquiry('inquiry-a'),undefined));
  const parent=f.calls.findIndex(c=>c.sql.includes('FOR UPDATE OF i'));
  const filtered=f.calls.findIndex((c,index)=>index>parent&&c.sql.includes('.source_visibility'));
  assert.ok(parent>=0&&filtered>parent,'Filter is re-evaluated after obtaining the parent lock');
});

test('a lease expiring after transactional read prevents workflow mutation and rolls back',async()=>{
  const f=harness({updateVisible:false});
  await assert.rejects(f.store.transaction('tenant-a',async tx=>{
    const row=await tx.getInquiry('inquiry-a');row.status='closed';row.version++;
    await tx.saveInquiry(row);
  }),/source_visibility_or_version_conflict/);
  const update=f.calls.find(c=>c.sql.startsWith('UPDATE'));
  assert.match(update.sql,/UPDATE .*\.inquiries i SET/);assert.match(update.sql,/source_visibility/);
  assert.equal(f.calls.at(-1).sql,'ROLLBACK');
});

test('a lease expiring between parent update and note insert prevents the note and rolls back both',async()=>{
  const f=harness({noteVisible:false});
  await assert.rejects(f.store.transaction('tenant-a',async tx=>{
    const row=await tx.getInquiry('inquiry-a');row.version++;
    row.notes.push({id:'note-a',tenantId:'tenant-a',inquiryId:'inquiry-a',authorId:'member-a',text:'Synthetic note',createdAt:at});
    await tx.saveInquiry(row);
  }),/source_visibility_or_version_conflict/);
  const insert=f.calls.find(c=>c.sql.startsWith('INSERT INTO')&&c.sql.includes('.notes'));
  assert.match(insert.sql,/SELECT \$1::varchar,\$2::varchar,\$3::varchar,\$4::varchar,\$5::varchar,\$6::timestamptz/);assert.match(insert.sql,/source_visibility/);
  assert.equal(f.calls.at(-1).sql,'ROLLBACK');
  assert.ok(!f.calls.some(c=>c.sql.includes('INSERT INTO')&&c.sql.includes('.audit_events')));
});
