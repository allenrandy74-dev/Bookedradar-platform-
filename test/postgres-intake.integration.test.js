import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Pool} from 'pg';
import {persistPostgresVoiceLead,persistPostgresChatTurn} from '../src/postgres-intake-workflows.js';
import {PostgresRecoveryStore} from '../src/postgres-recovery-store.js';
import {PostgresWebChatStore} from '../src/postgres-aux-stores.js';
import {PostgresCallStateStore} from '../src/postgres-state-store.js';
import {postgresUnitOfWork} from '../src/postgres-unit-of-work.js';
const connectionString=process.env.POSTGRES_TEST_URL;
test('real Postgres: atomic intake workflows and retention',{skip:!connectionString},async t=>{
  const url=new URL(connectionString);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));assert.equal(url.pathname,'/bookedradar_test');
  const pool=new Pool({connectionString,max:10});
  const tenant={tenantId:'t1',timeZone:'America/Chicago',policies:{sms:{allowTransactionalWhenInbound:true}},economics:{defaultAverageJobValue:500}};
  const recovery=new PostgresRecoveryStore(pool,'t1');
  try{
    await pool.query('DROP SCHEMA IF EXISTS bookedradar CASCADE');await pool.query(await fs.readFile(new URL('../db/postgres-schema.sql',import.meta.url),'utf8'));
    await t.test('voice capture commits lead, opportunity and call reference together',async()=>{
      const args={name:'Synthetic',service_type:'repair',callback_number:'+14095550111',urgency:'routine'};
      const result=await persistPostgresVoiceLead(pool,{tenant,callId:'voice-1',callerNumber:'+14095550111',args});
      assert.equal((await new PostgresCallStateStore(pool,'t1').getCall('voice-1')).opportunityId,result.recoveryResult.opportunity.id);
      await persistPostgresVoiceLead(pool,{tenant,callId:'voice-1',callerNumber:'+14095550111',args:{...args,name:'Updated'}});
      assert.equal(Object.keys((await recovery.snapshot()).opportunities).length,1);
    });
    await t.test('late call-state failure rolls back lead and entire recovery workflow',async()=>{
      const before=await recovery.snapshot();const count=(await pool.query('SELECT count(*) FROM bookedradar.lead_captures')).rows[0].count;
      await pool.query("ALTER TABLE bookedradar.call_control_state ADD CONSTRAINT reject_late CHECK (call_id<>'reject-call') NOT VALID");
      await assert.rejects(persistPostgresVoiceLead(pool,{tenant,callId:'reject-call',callerNumber:'+14095550112',args:{name:'Failed',service_type:'repair'}}));
      assert.deepEqual(await recovery.snapshot(),before);assert.equal((await pool.query('SELECT count(*) FROM bookedradar.lead_captures')).rows[0].count,count);
      await pool.query('ALTER TABLE bookedradar.call_control_state DROP CONSTRAINT reject_late');
    });
    await t.test('stale chat revision rolls back contact and opportunity updates',async()=>{
      const chat=new PostgresWebChatStore(pool,'t1');const session=await chat.getOrCreate();
      const turn={reply:'We will follow up.',needsHuman:true,fields:{name:'Original',phone:'+14095550113',service_type:'repair'}};
      const saved=await persistPostgresChatTurn(pool,{tenant,session,turn,message:'hello'});assert.ok(saved.opportunityId);
      const before=await recovery.snapshot();
      await assert.rejects(persistPostgresChatTurn(pool,{tenant,session,turn:{...turn,fields:{...turn.fields,name:'Stale name'}},message:'stale'}),/stale_chat_revision/);
      assert.deepEqual(await recovery.snapshot(),before);
      assert.equal((await chat.getOrCreate(session.id)).revision,1);
    });
    await t.test('nested commits cannot survive an outer workflow failure',async()=>{
      const before=await recovery.snapshot();
      await assert.rejects(postgresUnitOfWork(pool,'t1',async tx=>{await new PostgresRecoveryStore(tx,'t1').upsertContact('t1:rollback',{name:'Never committed'});throw new Error('outer_failure');}),/outer_failure/);
      assert.deepEqual(await recovery.snapshot(),before);
    });
    await t.test('retention deletes expired terminal work and keeps uncertain sends and their audit',async()=>{
      const old='2025-01-01T00:00:00Z';const now=new Date('2026-09-29T00:00:00Z');
      for(const [id,status] of [['old-complete','completed'],['old-uncertain','reconciliation_required']]){
        const payload={id,tenantId:'t1',status,createdAt:old,completedAt:old};
        await pool.query('INSERT INTO bookedradar.recovery_actions(action_id,tenant_id,status,created_at,completed_at,payload) VALUES($1,$2,$3,$4,$4,$5)',[id,'t1',status,old,JSON.stringify(payload)]);
      }
      const result=await recovery.prune({now,eventRetentionDays:90,actionRetentionDays:180});assert.equal(result.deletedActions,1);
      const snapshot=await recovery.snapshot();assert.ok(snapshot.actions['old-uncertain']);assert.equal(snapshot.actions['old-complete'],undefined);
      assert.throws(()=>recovery.prune({eventRetentionDays:0}),/retention_options_invalid/);
    });
  }finally{await pool.query('DROP SCHEMA IF EXISTS bookedradar CASCADE');await pool.end();}
});
