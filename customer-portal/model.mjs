// Client-side demo validation is NOT an authorization boundary. See server/.
export const STATUS = Object.freeze({new:'Needs attention',in_progress:'In progress',waiting:'Waiting on customer',closed:'Closed'});
export const TRANSITIONS = Object.freeze({new:['in_progress','closed'],in_progress:['waiting','closed'],waiting:['in_progress','closed'],closed:['in_progress']});
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function selectInquiries(records,tenantId,{filter='all',query=''}={}) {
  const needle=query.trim().toLocaleLowerCase();
  return records.filter(x=>x.tenantId===tenantId)
    .filter(x=>filter==='all'||(filter==='attention'?x.status!=='closed'&&x.status!=='waiting':x.status===filter))
    .filter(x=>!needle||[x.customerName,x.subject,x.source,x.id].some(v=>String(v).toLocaleLowerCase().includes(needle)))
    .sort((a,b)=>Number(b.priority==='high')-Number(a.priority==='high')||Date.parse(b.receivedAt)-Date.parse(a.receivedAt));
}
const validDate = value => typeof value==='string' && Number.isFinite(Date.parse(value));
const nonempty = value => typeof value==='string' && value.trim().length>0;
export function validPayment(record, records, tenantId) {
  const r=record.confirmedRevenue;
  return Boolean(record.tenantId===tenantId && r && record.currency==='USD' && Number.isFinite(r.amount) && r.amount>=0 && nonempty(r.source) && validDate(r.confirmedAt) && nonempty(r.reference) && records.filter(x=>x.tenantId===tenantId&&x.confirmedRevenue?.reference===r.reference).length===1);
}
export function validBooking(record, records, tenantId) {
  const b=record.booking;
  return Boolean(record.tenantId===tenantId && b && nonempty(b.id) && nonempty(b.source) && validDate(b.confirmedAt) && records.filter(x=>x.tenantId===tenantId&&x.booking?.id===b.id).length===1);
}
export function summarize(records,tenantId) {
  const items=selectInquiries(records,tenantId);
  const valued=x=>x.currency==='USD'&&Number.isFinite(x.potentialValue)&&x.potentialValue>=0;
  const payments=items.filter(x=>validPayment(x,items,tenantId));
  const bookings=items.filter(x=>validBooking(x,items,tenantId));
  const invalidPayment=items.some(x=>x.confirmedRevenue&&!validPayment(x,items,tenantId));
  const invalidBooking=items.some(x=>x.booking&&!validBooking(x,items,tenantId));
  return {captured:items.length,attention:items.filter(x=>!['closed','waiting'].includes(x.status)).length,waiting:items.filter(x=>x.status==='waiting').length,closed:items.filter(x=>x.status==='closed').length,replied:items.filter(x=>validDate(x.repliedAt)).length,booked:invalidBooking?null:bookings.length,potentialValue:items.filter(x=>x.status!=='closed'&&valued(x)).reduce((n,x)=>n+x.potentialValue,0),missingValue:items.filter(x=>x.status!=='closed'&&!valued(x)).length,confirmedRevenue:invalidPayment?null:payments.reduce((n,x)=>n+x.confirmedRevenue.amount,0),confirmedCount:payments.length};
}
export function updateDemoInquiry(records,tenantId,id,patch,{version,members,actorId,now=new Date().toISOString()}={}) {
  const current=records.find(x=>x.id===id&&x.tenantId===tenantId);
  if(!current)throw new Error('Inquiry not found.');
  if(version!==current.version)throw new Error('This inquiry changed. Refresh before saving.');
  if(!members?.some(x=>x.id===actorId&&x.tenantId===tenantId))throw new Error('Demo team member not found.');
  const keys=Object.keys(patch);if(!keys.length||keys.some(x=>!['status','assigneeId','note'].includes(x)))throw new Error('Unsupported update.');
  if('status' in patch&&!Object.hasOwn(STATUS,patch.status))throw new Error('Choose a valid status.');
  if('assigneeId' in patch&&patch.assigneeId!==null&&!members.some(x=>x.id===patch.assigneeId&&x.tenantId===tenantId))throw new Error('Choose a team member in this workspace.');
  if('note' in patch&&(typeof patch.note!=='string'||!patch.note.trim()||patch.note.trim().length>2000))throw new Error('Add a note between 1 and 2,000 characters.');
  if('status' in patch && patch.status!==current.status && !TRANSITIONS[current.status].includes(patch.status))throw new Error('Choose an allowed next status.');
  if(!('note' in patch) && (!('status' in patch)||patch.status===current.status) && (!('assigneeId' in patch)||patch.assigneeId===current.assigneeId))throw new Error('No changes to save.');
  const next=structuredClone(current);
  if('status' in patch)next.status=patch.status;
  if('assigneeId' in patch)next.assigneeId=patch.assigneeId;
  if('note' in patch)next.notes.push({id:`demo-note-${current.version+1}`,text:patch.note.trim(),authorId:actorId,createdAt:now});
  next.updatedAt=now;next.version++;
  return records.map(x=>x===current?next:x);
}
