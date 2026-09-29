import { postgresUnitOfWork } from './postgres-unit-of-work.js';
import { PostgresCallStateStore } from './postgres-state-store.js';
import { PostgresRecoveryStore } from './postgres-recovery-store.js';
import { PostgresLeadStore } from './postgres-lead-store.js';
import { PostgresWebChatStore } from './postgres-aux-stores.js';
import { normalizeLead } from './operator.js';

export function persistPostgresVoiceLead(pool,{tenant,callId,callerNumber,args}) {
  return postgresUnitOfWork(pool,tenant.tenantId,async tx=>{
    const state=new PostgresCallStateStore(tx,tenant.tenantId);const recovery=new PostgresRecoveryStore(tx,tenant.tenantId);
    const existingCall=await state.getCall(callId);
    const lead=normalizeLead(args,{call_id:callId,caller_number:callerNumber,previous_lead:existingCall?.lastLead});
    await new PostgresLeadStore(tx,tenant.tenantId).append({...lead,tenant_id:tenant.tenantId});
    let opportunity=existingCall?.opportunityId ? await recovery.getOpportunity(existingCall.opportunityId) : null;
    if(opportunity){
      await recovery.upsertContact(opportunity.contactKey,{name:lead.name || undefined,phone:lead.callback_number || undefined,transactionalSmsAllowed:true});
      opportunity=await recovery.patchOpportunity(opportunity.id,{serviceType:lead.service_type || opportunity.serviceType,urgency:lead.urgency || opportunity.urgency,metadata:{...(opportunity.metadata || {}),callId,serviceAddress:lead.service_address || opportunity.metadata?.serviceAddress || '',city:lead.city || opportunity.metadata?.city || '',preferredWindow:lead.preferred_window || opportunity.metadata?.preferredWindow || '',notes:lead.notes || opportunity.metadata?.notes || ''}});
    }else{
      const result=await recovery.ingest({idempotencyKey:`phone-lead:${tenant.tenantId}:${callId}`,type:'phone_lead',source:'ai_phone_operator',serviceType:lead.service_type || '',urgency:lead.urgency || '',contact:{name:lead.name || '',phone:lead.callback_number || '',transactionalSmsAllowed:true},metadata:{callId,serviceAddress:lead.service_address || '',city:lead.city || '',preferredWindow:lead.preferred_window || '',notes:lead.notes || ''}},tenant);
      opportunity=result.opportunity;
      if(!opportunity && result.duplicate)opportunity=Object.values((await recovery.snapshot()).opportunities).find(o=>o.sourceEventId===result.event?.id);
      if(!opportunity)throw new Error('voice_opportunity_not_persisted');
    }
    await state.patchCall(callId,{tenantId:tenant.tenantId,opportunityId:opportunity.id,lastLeadAt:Date.now(),lastLead:lead});
    return {lead,existingCall,recoveryResult:{opportunity}};
  });
}

export function persistPostgresChatTurn(pool,{tenant,session,turn,message}) {
  return postgresUnitOfWork(pool,tenant.tenantId,async tx=>{
    const recovery=new PostgresRecoveryStore(tx,tenant.tenantId);const chat=new PostgresWebChatStore(tx,tenant.tenantId);
    const fields=turn.fields || {};let opportunityId=session.opportunityId || null;
    const phone=/^\+[1-9]\d{7,14}$/.test(String(fields.phone || ''));const email=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(fields.email || ''));
    if(fields.service_type && (phone || email)){
      let existing=opportunityId ? await recovery.getOpportunity(opportunityId) : null;
      if(existing){
        await recovery.upsertContact(existing.contactKey,{name:fields.name || undefined,phone:phone ? fields.phone : undefined,email:email ? fields.email : undefined});
        await recovery.patchOpportunity(opportunityId,{serviceType:fields.service_type || existing.serviceType,urgency:fields.urgency || existing.urgency,metadata:{...(existing.metadata || {}),serviceAddress:fields.service_address || existing.metadata?.serviceAddress || '',city:fields.city || existing.metadata?.city || '',preferredWindow:fields.preferred_window || existing.metadata?.preferredWindow || '',sourceSessionId:session.id}});
      }else{
        const captured=await recovery.ingest({idempotencyKey:`web-chat:${tenant.tenantId}:${session.id}`,type:'web_lead',source:'web_chat',serviceType:fields.service_type,urgency:fields.urgency || '',contact:{name:fields.name || '',phone:phone ? fields.phone : '',email:email ? fields.email : ''},metadata:{serviceAddress:fields.service_address || '',city:fields.city || '',preferredWindow:fields.preferred_window || '',sourceSessionId:session.id}},tenant);
        existing=captured.opportunity;
        if(!existing && captured.duplicate)existing=Object.values((await recovery.snapshot()).opportunities).find(o=>o.sourceEventId===captured.event?.id);
        if(!existing)throw new Error('chat_opportunity_not_persisted');opportunityId=existing.id;
      }
    }
    if(turn.needsHuman && opportunityId){
      const snapshot=await recovery.snapshot();
      if(!Object.values(snapshot.actions).some(a=>a.opportunityId===opportunityId && a.channel==='human_alert' && !['failed','blocked','cancelled'].includes(a.status))){
        const opportunity=await recovery.getOpportunity(opportunityId);
        await recovery.scheduleAction({tenantId:tenant.tenantId,opportunityId,contactKey:opportunity.contactKey,channel:'human_alert',template:'web_chat_human_request',purpose:'service',dueAt:new Date().toISOString()});
      }
    }
    const messages=[...(session.messages || []),{role:'visitor',text:message,at:new Date().toISOString()},{role:'assistant',text:turn.reply,at:new Date().toISOString()}].slice(-24);
    return chat.update(session.id,{fields,messages,opportunityId},{expectedRevision:session.revision || 0});
  });
}
