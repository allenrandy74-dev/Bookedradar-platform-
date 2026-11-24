import test from 'node:test';
import assert from 'node:assert/strict';
import {DEMO_TENANT as tenant,members,createFixtures} from '../fixtures.mjs';
import {selectInquiries,summarize,updateDemoInquiry,escapeHtml} from '../model.mjs';
const opts={version:1,members,actorId:'alex',now:'2026-10-12T15:40:00Z'};
test('initial demo metrics distinguish potential, replies, bookings and explicit payments',()=>{
  assert.deepEqual(summarize(createFixtures(),tenant),{captured:6,attention:3,waiting:1,closed:2,replied:2,booked:1,potentialValue:7460,missingValue:1,confirmedRevenue:125,confirmedCount:1});
});
test('every model read excludes records from other demo tenants',()=>{
  const rows=createFixtures();rows.push({...rows[0],id:'foreign',tenantId:'other',potentialValue:999999});
  assert.equal(selectInquiries(rows,tenant).length,6);assert.equal(summarize(rows,tenant).potentialValue,7460);
  assert.equal(selectInquiries(rows,'missing').length,0);
});
test('search/filter is case insensitive and retains priority sorting',()=>{
  assert.equal(selectInquiries(createFixtures(),tenant,{query:' TAYLOR '})[0].id,'inq-1041');
  assert.equal(selectInquiries(createFixtures(),tenant,{filter:'closed'}).length,2);
  assert.equal(selectInquiries(createFixtures(),tenant,{filter:'attention'})[0].id,'inq-1042');
  assert.equal(selectInquiries(createFixtures(),tenant,{query:'not found'}).length,0);
});
test('workflow changes remain immutable and never manufacture outcome evidence',()=>{
  const rows=createFixtures();const next=updateDemoInquiry(rows,tenant,'inq-1042',{status:'closed',assigneeId:'alex'},opts);
  assert.equal(rows[0].status,'new');assert.equal(next[0].version,2);assert.equal(next[0].status,'closed');
  assert.equal(next[0].booking,null);assert.equal(next[0].confirmedRevenue,null);
  assert.equal(summarize(next,tenant).confirmedRevenue,125);assert.equal(summarize(next,tenant).booked,1);
});
test('wrong tenant and forged assignee or actor cannot mutate demo records',()=>{
  assert.throws(()=>updateDemoInquiry(createFixtures(),'other','inq-1042',{status:'closed'},opts),/not found/);
  assert.throws(()=>updateDemoInquiry(createFixtures(),tenant,'inq-1042',{assigneeId:'foreign'},opts),/team member/);
  assert.throws(()=>updateDemoInquiry(createFixtures(),tenant,'inq-1042',{status:'closed'},{...opts,actorId:'foreign'}),/not found/);
});
test('stale revision rejects repeated saves',()=>{
  const next=updateDemoInquiry(createFixtures(),tenant,'inq-1042',{status:'in_progress'},opts);
  assert.throws(()=>updateDemoInquiry(next,tenant,'inq-1042',{status:'closed'},opts),/changed/);
});
test('unsupported outcome fields, statuses and prototype keys are rejected',()=>{
  for(const patch of [{confirmedRevenue:500},{status:'booked'},{status:'toString'},{},JSON.parse('{"__proto__":{"x":1}}')])
    assert.throws(()=>updateDemoInquiry(createFixtures(),tenant,'inq-1042',patch,opts));
});
test('notes are bounded, trimmed and stored as plain text with actor selected by context',()=>{
  for(const note of ['', '   ','x'.repeat(2001),42])assert.throws(()=>updateDemoInquiry(createFixtures(),tenant,'inq-1042',{note},opts));
  const next=updateDemoInquiry(createFixtures(),tenant,'inq-1042',{note:' <script>alert(1)</script> '},opts);
  assert.equal(next[0].notes[0].authorId,'alex');assert.equal(next[0].notes[0].text,'<script>alert(1)</script>');
  assert.equal(escapeHtml(next[0].notes[0].text),'&lt;script&gt;alert(1)&lt;/script&gt;');
});
test('missing or duplicate payment evidence makes confirmed total unavailable',()=>{
  for(const field of ['source','confirmedAt','reference']){const rows=createFixtures();delete rows[5].confirmedRevenue[field];assert.equal(summarize(rows,tenant).confirmedRevenue,null);}
  const rows=createFixtures();rows[0].confirmedRevenue={...rows[5].confirmedRevenue};assert.equal(summarize(rows,tenant).confirmedRevenue,null);
});
test('currency, negative, infinite amounts and unconfirmed bookings are not treated as valid evidence',()=>{
  for(const value of [-1,Infinity,NaN]){const rows=createFixtures();rows[5].confirmedRevenue.amount=value;assert.equal(summarize(rows,tenant).confirmedRevenue,null);}
  const rows=createFixtures();rows[5].currency='EUR';rows[4].booking.confirmedAt='invalid';assert.equal(summarize(rows,tenant).confirmedRevenue,null);assert.equal(summarize(rows,tenant).booked,null);
});
test('empty snapshots have zero records but never fabricated opportunity values',()=>{const s=summarize([],tenant);assert.equal(s.captured,0);assert.equal(s.potentialValue,0);assert.equal(s.confirmedRevenue,0);});
test('team workflow uses allowed transitions and rejects unchanged writes',()=>{
  assert.throws(()=>updateDemoInquiry(createFixtures(),tenant,'inq-1042',{status:'waiting'},opts),/allowed/);
  assert.throws(()=>updateDemoInquiry(createFixtures(),tenant,'inq-1042',{status:'new',assigneeId:null},opts),/No changes/);
});
test('invalid estimates and mixed currencies increase missing coverage rather than polluting USD',()=>{
  for(const value of [NaN,-1,Infinity,null]){const rows=createFixtures();rows[0].potentialValue=value;const s=summarize(rows,tenant);assert.equal(s.potentialValue,7080);assert.equal(s.missingValue,2);}
  const rows=createFixtures();rows[0].currency='CAD';assert.equal(summarize(rows,tenant).potentialValue,7080);assert.equal(summarize(rows,tenant).missingValue,2);
});
test('invalid reply dates and duplicate booking evidence never produce positive outcomes',()=>{
  const rows=createFixtures();rows[0].repliedAt='not-a-date';assert.equal(summarize(rows,tenant).replied,2);
  rows[0].booking={...rows[4].booking};assert.equal(summarize(rows,tenant).booked,null);
});
