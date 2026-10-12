/** Connected staging entrypoint. Never imported by the frozen synthetic Sites preview. */
import {createPortalClient,safeLogoutDestination} from './client.mjs';

const STATUS = Object.freeze({new:'New',in_progress:'In progress',waiting:'Waiting',closed:'Closed'});
const TRANSITIONS = Object.freeze({new:['in_progress','closed'],in_progress:['waiting','closed'],waiting:['in_progress','closed'],closed:['in_progress']});
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const paths = {
  inbox:'<path d="M4 4h16v16H4zM4 13h5l1 3h4l1-3h5"/>',
  help:'<circle cx="12" cy="12" r="9"/><path d="M9.4 9a2.6 2.6 0 0 1 5.2 0c0 2-2.6 2-2.6 4M12 16h.01"/>',
  lock:'<rect x="6" y="10" width="12" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2"/>',
  arrow:'<path d="M5 12h14M14 7l5 5-5 5"/>',
  search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  close:'<path d="m6 6 12 12M18 6 6 18"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.inbox}</svg>`;
const $ = id => document.getElementById(id);
const main = $('main'), dialog = $('inquiry-dialog'), client = createPortalClient();
const drafts = new Map(), notices = new Map(), needsReview = new Set();
let phase = 'session-loading', session = null, records = [], members = [];
let view = 'inbox', filter = 'open', query = '', selectedId = null, detail = null, detailPhase = 'idle';
let saving = null, sessionEpoch = 0, listEpoch = 0, detailEpoch = 0, toastTimer, lastStale = true;
let refreshing = false, loggingOut = false, hadSession = false, openedFromRow = false, returnFocusId = null;
let verifyingSession = false, pendingVerification = false;
let authChannel = null;
try { authChannel = new BroadcastChannel('bookedradar-portal-auth'); } catch { /* Focus verification remains available. */ }

function date(value) {
  const timestamp = typeof value==='number'?value:Date.parse(value);
  return Number.isFinite(timestamp) ? new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(timestamp) : 'Unavailable';
}
function age(value) {
  const elapsed = Math.max(0,Date.now()-Date.parse(value));
  if(!Number.isFinite(elapsed)) return 'Unknown';
  const minutes = Math.floor(elapsed/60000);
  return minutes < 1 ? 'Just now' : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes/60)}h ago` : `${Math.floor(minutes/1440)}d ago`;
}
const memberName = id => id ? members.find(member => member.id === id)?.name || 'Team member unavailable' : 'Unassigned';
const initials = name => name.split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]).join('').toUpperCase();
const draftFor = id => drafts.get(id) || {};
const stale = () => client.state().stale;
const canWrite = () => phase === 'ready' && session?.canEdit && !refreshing && !loggingOut && !saving && !stale() && !needsReview.has(selectedId) && detailPhase === 'ready';
const ignored = error => error?.code === 'superseded';
const expired = error => error?.code === 'session_unavailable' || error?.code === 'session_required';

function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').classList.add('visible');
  toastTimer = setTimeout(()=>$('toast').classList.remove('visible'),4200);
}
function clearToast() { clearTimeout(toastTimer); $('toast').textContent=''; $('toast').classList.remove('visible'); }
function captureDraft() {
  if(!selectedId || detailPhase !== 'ready' || !detail) return;
  const previous = draftFor(selectedId), next = {...previous};
  const status = $('workflow-status'), owner = $('workflow-owner'), note = $('internal-note');
  if(status && status.value !== detail.status) next.status = status.value; else delete next.status;
  if(owner && owner.value !== (detail.assigneeId || '')) next.assigneeId = owner.value || null; else delete next.assigneeId;
  if(note) next.text = note.value;
  if(next.uncertainNote&&next.text?.trim()!==next.uncertainNote.text)delete next.uncertainNote;
  drafts.set(selectedId,next);
}
function closeDialog({forgetSelection=true}={}) {
  captureDraft(); detailEpoch++;
  if(dialog.open) dialog.close();
  $('detail-content').replaceChildren(); detail=null;detailPhase='idle';
  if(forgetSelection) selectedId=null;
}
function clearPrivateState(nextPhase) {
  sessionEpoch++; listEpoch++; detailEpoch++;
  client.clear(); session=null;records=[];members=[];drafts.clear();notices.clear();needsReview.clear();
  // Clear the selection before closing so old fields cannot be captured into a draft.
  selectedId=null;detail=null;detailPhase='idle';
  if(dialog.open)dialog.close();$('detail-content').replaceChildren();
  saving=null;refreshing=false;loggingOut=false;verifyingSession=false;pendingVerification=false;openedFromRow=false;returnFocusId=null;query='';filter='open';phase=nextPhase;clearToast();
  render();
}
function authFailure(error) {
  if(expired(error)) { clearPrivateState(hadSession?'expired':'anonymous');return true; }
  return false;
}
function heading(title,subtitle,action=true) {
  return `<div class="page-heading"><div><div class="eyebrow">${esc(session?.tenant?.name || 'BOOKEDRADAR')} · STAGING WORKSPACE</div><h1>${title}</h1><p>${subtitle}</p></div>${action?`<div class="section-actions"><button class="secondary-button" data-refresh ${saving || refreshing?'disabled':''}>${refreshing?'Refreshing…':'Refresh snapshot'}</button></div>`:''}</div>`;
}
function sessionScreen() {
  if(phase==='session-loading') return '<section class="panel empty-state login-panel" role="status"><span class="empty-icon">'+icon('lock')+'</span><h1>Checking your session…</h1><p>Customer records stay hidden until access is verified.</p></section>';
  const isLogin=['anonymous','expired','signed-out'].includes(phase);
  const title=phase==='expired'?'Your session has ended.':phase==='signed-out'?'You’re signed out.':phase==='anonymous'?'Your workspace, one sign-in away.':phase==='logout-error'?'Sign-out couldn’t be confirmed.':'We couldn’t verify your session.';
  const subtitle=phase==='expired'?'Sign in again to open the staging workspace. Unsaved drafts were cleared to protect the account.':phase==='signed-out'?'The workspace and this tab’s drafts have been cleared.':phase==='anonymous'?'Use the Wix account approved for this owner-only pilot. Your business access is checked on the server.':phase==='logout-error'?'Your records are hidden. Try signing out again to end the server session.':'The workspace is unavailable right now. Your records remain hidden until a session can be verified.';
  return `<section class="panel empty-state login-panel" ${isLogin?'':'role="alert"'}><span class="empty-icon">${icon('lock')}</span><p class="login-eyebrow">BOOKEDRADAR · OWNER-ONLY PILOT</p><h1>${title}</h1><p>${subtitle}</p>${isLogin?'<a class="primary-button" href="/api/auth/login">Sign in with Wix '+icon('arrow')+'</a>':`<button class="primary-button" ${phase==='logout-error'?'data-logout':'data-retry-session'}>${phase==='logout-error'?'Retry sign out':'Try again'}</button>`}<p class="login-note">Staging • Synthetic records<br>Login happens on Wix. There are no passwords, API keys or tenant selectors to enter here.</p></section>`;
}
function snapshotNotice() {
  if(!stale())return '';
  return '<div class="state-banner" role="status"><p><strong>This snapshot needs a refresh.</strong><br>You can review these records. Refresh before saving changes.</p><button class="secondary-button" data-refresh '+(saving?'disabled':'')+'>Refresh snapshot</button></div>';
}
function listItems() {
  const search=query.trim().toLocaleLowerCase();
  return records.filter(record=>(filter==='all'||(filter==='closed'?record.status==='closed':record.status!=='closed'))&&(!search||[record.subject,record.customerName,record.summary,record.source].some(value=>String(value).toLocaleLowerCase().includes(search))));
}
function row(record) {
  const owner=memberName(record.assigneeId);
  return `<li><button class="inquiry-row" data-open="${esc(record.id)}" aria-label="Open inquiry: ${esc(record.subject)}, ${esc(record.customerName)}" ${saving?'disabled':''}><span class="source-icon">${icon('inbox')}</span><span class="row-main"><span class="row-title">${esc(record.subject)}</span><span class="row-customer">${esc(record.customerName)} <span aria-hidden="true">·</span> ${esc(record.source)}</span><span class="row-meta"><span class="status-chip status-${esc(record.status)}">${esc(STATUS[record.status])}</span><span class="assignee">${record.assigneeId?`<span class="avatar-tiny">${esc(initials(owner))}</span>`:''}${esc(owner)}</span></span></span><span class="row-right"><span class="row-time" title="${esc(date(record.receivedAt))}">${esc(age(record.receivedAt))}</span><span class="row-arrow">${icon('arrow')}</span></span></button></li>`;
}
function listResults() {
  const items=listItems();
  if(items.length)return `<ul class="inquiry-list">${items.map(row).join('')}</ul>`;
  const isFiltered=Boolean(query)||filter!=='all';
  return `<div class="empty-state"><span class="empty-icon">${icon(isFiltered?'search':'inbox')}</span><h2>${records.length?'No matching inquiries':'No inquiries in this snapshot'}</h2><p>${records.length?'Try another name, subject or filter.':'The server returned no synthetic inquiries for this workspace. Refresh to check for changes.'}</p>${records.length?'<button class="secondary-button" data-clear-filters>Clear filters</button>':''}</div>`;
}
function inbox() {
  const open=records.filter(record=>record.status!=='closed').length;
  const unassigned=records.filter(record=>record.status!=='closed'&&!record.assigneeId).length;
  const next=records.find(record=>record.status!=='closed'&&!record.assigneeId)||records.find(record=>record.status!=='closed');
  return `${heading('A clear view of what’s next.','Review the context. Choose an owner. Keep the next step moving.')}${snapshotNotice()}<div class="metric-grid snapshot-metrics" aria-label="Loaded snapshot counts">${[['Open in snapshot',open,'Team actions still open','inbox'],['Unassigned open',unassigned,'Ready for an owner','help'],['Loaded inquiries',records.length,'Up to 100 records','clock']].map(([label,count,note,image],index)=>`<section class="metric-card ${index===0?'featured':''}"><div class="metric-title">${label}<span class="metric-icon">${icon(image)}</span></div><div class="metric-value">${count}</div><div class="metric-note">${note}</div></section>`).join('')}</div><p class="snapshot-notice">A bounded snapshot of up to 100 synthetic inquiries. Counts, filters and search cover these loaded records only. This is not a complete business report.</p><div class="content-grid"><section class="panel" aria-labelledby="inbox-title"><div class="panel-heading"><div><h2 id="inbox-title">Your action inbox</h2><p>Human follow-through, with the context close by.</p></div><span class="count-badge">${records.length} loaded</span></div><div class="list-toolbar"><div class="filter-tabs" role="group" aria-label="Filter inquiries">${[['open','Open'],['all','All loaded'],['closed','Closed']].map(([value,label])=>`<button data-filter="${value}" aria-pressed="${filter===value}">${label}</button>`).join('')}</div><div class="search-box">${icon('search')}<label class="sr-only" for="inquiry-search">Search loaded inquiries</label><input id="inquiry-search" type="search" placeholder="Search this snapshot" autocomplete="off" value="${esc(query)}"></div></div><div id="list-results" aria-live="polite">${listResults()}</div><div class="list-footer"><span>Loaded ${esc(date(client.state().loadedAt))}</span><span>Maximum 100 records · no pagination</span></div></section><aside class="side-stack" aria-label="Workspace context"><section class="side-card spotlight"><span class="small-label">MAKE ROOM FOR FOLLOW-THROUGH</span><h2>${next?'One inquiry. A clear next step.':'A little breathing room.'}</h2><p>${next?'Review a synthetic inquiry, choose the person responsible and keep the team’s context in one place.':'There are no open team actions in this loaded snapshot. You can still review closed inquiries.'}</p>${next?`<button class="primary-button" data-open="${esc(next.id)}" ${saving?'disabled':''}>Review inquiry ${icon('arrow')}</button>`:'<button class="primary-button" data-clear-filters>View all loaded '+icon('arrow')+'</button>'}</section><section class="side-card"><h2>How this pilot works</h2><div class="mini-stat"><span>Data</span><strong>Synthetic only</strong></div><div class="mini-stat"><span>Your access</span><strong>${session.canEdit?'Can edit workflow':'Read only'}</strong></div><div class="mini-stat"><span>Saved changes</span><strong>Server-confirmed</strong></div><p class="side-footnote">Assignments, status and internal notes are saved in the staging workspace.</p><button class="text-button" data-guide>Read the workspace guide</button></section><section class="side-card quiet-card"><h2>${icon('shield')}A clear boundary</h2><p>Closing a team action does not confirm a booking, payment or sale. This workspace does not send customer messages or provider requests.</p></section></aside></div>`;
}
function guide() {
  return `${heading('A workspace built for follow-through.','A connected staging pilot, with a clear boundary around every action.',false)}<div class="guide-grid"><section class="panel guide-card"><span class="source-icon">${icon('inbox')}</span><h2>One place for the next step</h2><p>Open an inquiry, read the intake summary, choose a team member, update status and add an internal note. The server confirms each save before the workspace shows it as saved.</p><p>Open includes new, in-progress and waiting inquiries. Search and counts apply to the current snapshot, which contains at most 100 records.</p></section><section class="panel guide-card"><span class="source-icon">${icon('lock')}</span><h2>Access belongs to your account</h2><p>Sign in through Wix using the account approved for this owner-only pilot. The server verifies membership for every request. You cannot choose another business from the browser.</p><p>Signing out or a rejected session clears customer records and drafts from this tab. Unsaved drafts otherwise last only in this tab and disappear on reload.</p></section><section class="panel guide-card"><span class="source-icon">${icon('check')}</span><h2>Fresh records before changes</h2><p>A snapshot becomes read-only after one minute. Refresh it before saving. If another update reaches the server first, your draft is kept and a fresh version must be reviewed before retrying.</p><p>A connection error may happen after a save reaches the server. Check the refreshed record and notes before sending another save.</p></section><section class="panel guide-card"><span class="source-icon">${icon('shield')}</span><h2>Team workflow has its own meaning</h2><p>Status, assignment and notes are internal workflow. They do not send messages, make calls, update a calendar, dispatch a provider, confirm payments or establish revenue.</p><p>All records in this pilot are synthetic. No customer invitations or live customer records are enabled here.</p></section></div>`;
}
function loadingSnapshot() {
  return `${heading('Loading your workspace…','Getting a fresh snapshot from the staging server.',false)}<div role="status" aria-label="Loading inquiries"><div class="metric-grid snapshot-metrics">${Array.from({length:3},()=>'<div class="metric-card"><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-short"></div><div class="skeleton skeleton-line"></div></div>').join('')}</div><div class="panel">${Array.from({length:4},()=>'<div class="skeleton-row"><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line"></div></div>').join('')}</div></div>`;
}
function render() {
  const available=session&&phase==='ready';
  $('workspace-name').textContent=session?.tenant.name||'Staging workspace';
  $('session-name').textContent=session?memberName(session.memberId):'Signed out';
  $('session-role').textContent=session?(session.canEdit?'Workflow operator':'Read-only member'):'Protected workspace';
  $('sign-out').hidden=!session||phase==='logout-error';
  $('sign-out').disabled=Boolean(saving||loggingOut);
  $('sign-out').textContent=loggingOut?'Signing out…':'Sign out';
  $('nav-count').textContent=available?String(records.filter(record=>record.status!=='closed').length):'—';
  $('breadcrumb-title').textContent=view==='guide'?'Workspace guide':'Action inbox';
  document.querySelectorAll('[data-view]').forEach(link=>link.setAttribute('aria-current',link.dataset.view===view?'page':'false'));
  main.setAttribute('aria-busy',String(['session-loading','loading','verifying'].includes(phase)));
  main.innerHTML=!session||phase==='logout-error'?sessionScreen():phase==='verifying'?'<section class="panel empty-state login-panel" role="status"><span class="empty-icon">'+icon('lock')+'</span><h1>Verifying your session…</h1><p>Records are hidden while your account is checked.</p></section>':phase==='loading'?loadingSnapshot():phase==='error'?`${heading('This snapshot couldn’t be loaded.','Old records are hidden until the server returns a fresh snapshot.',false)}<section class="panel empty-state" role="alert"><span class="empty-icon">${icon('inbox')}</span><h2>No current records to show</h2><p>Your drafts are kept in this tab. Try refreshing the snapshot.</p><button class="primary-button" data-refresh>Try again</button></section>`:view==='guide'?guide():inbox();
  lastStale=stale();
}
function noticeMarkup(id) {
  const notice=notices.get(id);
  if(!notice)return '';
  return `<div class="detail-notice ${notice.info?'info':''}" role="${notice.info?'status':'alert'}"><p>${esc(notice.message)}</p>${needsReview.has(id)?`<button class="secondary-button" data-refresh ${saving||refreshing?'disabled':''}>Refresh and review</button>`:''}</div>`;
}
function detailMarkup(record) {
  const draft=draftFor(record.id), pickedStatus=draft.status??record.status;
  const owner='assigneeId' in draft?draft.assigneeId:record.assigneeId;
  const allowed=[record.status,...TRANSITIONS[record.status]], statuses=[...new Set([...allowed,pickedStatus])];
  const validStatus=allowed.includes(pickedStatus), ownerMissing=owner&&!members.some(member=>member.id===owner);
  const enabled=canWrite(), disabled=enabled?'':'disabled';
  const unchanged=pickedStatus===record.status&&owner===record.assigneeId;
  const note=draft.text||'';
  const memberOptions=[{id:'',name:'Unassigned'},...members];
  if(ownerMissing)memberOptions.push({id:owner,name:'Team member unavailable'});
  const uncertainMatch=draft.uncertainNote&&record.notes.some(note=>!draft.uncertainNote.ids.includes(note.id)&&note.text===draft.uncertainNote.text&&note.authorId===session.memberId);
  return `<div class="dialog-top"><span>INQUIRY ${esc(record.id)} <span class="demo-pill">STAGING</span></span><button class="icon-button" data-close aria-label="Close inquiry">${icon('close')}</button></div><div class="dialog-body"><div class="detail-eyebrow">${icon('inbox')}${esc(record.source)} <span>·</span> ${esc(date(record.receivedAt))}</div><h2 id="detail-title" tabindex="-1">${esc(record.subject)}</h2><p class="detail-customer">${esc(record.customerName)} · Synthetic customer</p><div class="detail-header-status"><span class="status-chip status-${esc(record.status)}">${esc(STATUS[record.status])}</span><span class="record-version">Saved version ${record.version}</span></div>${noticeMarkup(record.id)}${stale()&&!needsReview.has(record.id)?'<div class="detail-notice stale-hint" role="status"><p>This snapshot is out of date. Your draft is kept. Refresh before saving.</p><button class="secondary-button" data-refresh '+(saving?'disabled':'')+'>Refresh and review</button></div>':''}<p class="detail-summary">${esc(record.summary)}</p><dl class="detail-grid"><div><dt>Email</dt><dd>${esc(record.contact.email||'Not provided')}</dd></div><div><dt>Phone</dt><dd>${esc(record.contact.phone||'Not provided')}</dd></div><div><dt>Received</dt><dd>${esc(date(record.receivedAt))}</dd></div><div><dt>Last saved</dt><dd>${esc(date(record.updatedAt))}</dd></div></dl><section class="detail-section"><h3>Team workflow</h3><p>Assign the next step and keep your team’s status current.</p>${!session.canEdit?'<div class="detail-callout">Your membership is read only. You can review records but cannot save changes.</div>':''}<div class="workflow-grid"><div class="field"><label for="workflow-status">Status</label><select id="workflow-status" ${disabled}>${statuses.map(status=>`<option value="${esc(status)}" ${status===pickedStatus?'selected':''} ${allowed.includes(status)?'':'disabled'}>${esc(STATUS[status])}${allowed.includes(status)?'':' · choose a valid next status'}</option>`).join('')}</select></div><div class="field"><label for="workflow-owner">Assigned to</label><select id="workflow-owner" ${disabled}>${memberOptions.map(member=>`<option value="${esc(member.id)}" ${member.id===(owner||'')?'selected':''} ${ownerMissing&&member.id===owner?'disabled':''}>${esc(member.name)}</option>`).join('')}</select></div></div><div class="form-footer"><span class="form-hint">${!validStatus?'The saved status changed. Choose an allowed next status.':'Closing an action does not confirm a booking or a sale.'}</span><button class="primary-button" data-save-workflow ${!enabled||unchanged||!validStatus||(ownerMissing&&owner!==record.assigneeId)?'disabled':''}>${saving?.kind==='workflow'?'Saving…':'Save workflow'}</button></div></section><section class="detail-section"><h3>Internal notes <span class="record-version">${record.notes.length}</span></h3>${record.notes.length?record.notes.map(note=>`<article class="note"><p>${esc(note.text)}</p><small>${esc(memberName(note.authorId))} · ${esc(date(note.createdAt))}</small></article>`).join(''):'<p>No internal notes yet.</p>'}<div class="field"><label for="internal-note">Internal note</label><textarea id="internal-note" maxlength="2000" placeholder="Keep the context your team needs…" ${disabled}>${esc(note)}</textarea></div>${uncertainMatch?'<div class="detail-notice" role="status"><p>A matching note is now in the saved record. Review it before adding another. Clear this draft if it is already saved.</p><button class="secondary-button" data-clear-note>Clear note draft</button></div>':''}<div class="form-footer"><span class="form-hint">Internal only. No customer message is sent.<br><span id="note-counter" class="note-counter">${note.length} / 2,000</span></span><button class="primary-button" data-save-note ${!enabled||!note.trim()||uncertainMatch||record.notes.length>=1000?'disabled':''}>${saving?.kind==='note'?'Saving…':'Add note'}</button></div>${record.notes.length>=1000?'<p>This inquiry has reached the internal note limit.</p>':''}</section></div>`;
}
function renderDetail() {
  if(!selectedId)return;
  const scroll=dialog.scrollTop, wasOpen=dialog.open;
  const focused=dialog.contains(document.activeElement)?document.activeElement:null;
  const focusId=focused?.id, focusClose=focused?.hasAttribute('data-close');
  if(detailPhase==='ready'&&detail) $('detail-content').innerHTML=detailMarkup(detail);
  else $('detail-content').innerHTML=`<div class="dialog-top"><span>INQUIRY</span><button class="icon-button" data-close aria-label="Close inquiry">${icon('close')}</button></div><section class="empty-state" role="${detailPhase==='error'?'alert':'status'}"><h2 id="detail-title" tabindex="-1">${detailPhase==='error'?'This inquiry couldn’t be loaded.':'Loading inquiry…'}</h2><p>${detailPhase==='error'?'The current record is hidden. Your draft is kept in this tab.':'Getting the saved version from the staging server.'}</p>${detailPhase==='error'?'<button class="secondary-button" data-retry-detail>Try again</button>':''}</section>`;
  if(!dialog.open)dialog.showModal();
  else if(wasOpen){
    const previous=focusId?$(focusId):focusClose?dialog.querySelector('[data-close]'):null;
    const target=previous&&!previous.disabled?previous:$('detail-title');
    target?.focus({preventScroll:true});
  }
  dialog.scrollTop=scroll;
}
function updateFormButtons() {
  if(!selectedId||!detail||detailPhase!=='ready')return;
  captureDraft();
  const draft=draftFor(selectedId), pickedStatus=draft.status??detail.status, owner='assigneeId'in draft?draft.assigneeId:detail.assigneeId;
  const enabled=canWrite(), allowed=[detail.status,...TRANSITIONS[detail.status]];
  const ownerValid=!owner||members.some(member=>member.id===owner)||owner===detail.assigneeId;
  const uncertainMatch=draft.uncertainNote&&detail.notes.some(note=>!draft.uncertainNote.ids.includes(note.id)&&note.text===draft.uncertainNote.text&&note.authorId===session.memberId);
  const workflow=dialog.querySelector('[data-save-workflow]'), noteButton=dialog.querySelector('[data-save-note]');
  if(workflow)workflow.disabled=!enabled||!allowed.includes(pickedStatus)||!ownerValid||(pickedStatus===detail.status&&owner===detail.assigneeId);
  if(noteButton)noteButton.disabled=!enabled||!draft.text?.trim()||Boolean(uncertainMatch)||detail.notes.length>=1000;
  if($('note-counter'))$('note-counter').textContent=`${draft.text?.length||0} / 2,000`;
}

async function boot() {
  clearPrivateState('session-loading');const ticket=sessionEpoch;
  try {
    const verified=await client.loadSession();
    if(ticket!==sessionEpoch)return;
    session=verified;hadSession=true;await refreshSnapshot();
  } catch(error) { if(ticket!==sessionEpoch||ignored(error)||authFailure(error))return;phase='session-error';render(); }
}
async function verifyCurrentSession() {
  if(!session||loggingOut||verifyingSession||document.visibilityState==='hidden')return;
  if(saving){pendingVerification=true;captureDraft();closeDialog({forgetSelection:false});phase='verifying';render();return;}
  captureDraft();closeDialog({forgetSelection:false});
  const ticket=++sessionEpoch;listEpoch++;detailEpoch++;refreshing=false;verifyingSession=true;records=[];phase='verifying';render();
  try {
    const verified=await client.revalidateSession();
    if(ticket!==sessionEpoch)return;
    session=verified;verifyingSession=false;await refreshSnapshot();
  } catch(error) {
    if(ticket!==sessionEpoch||ignored(error)||authFailure(error))return;
    clearPrivateState('session-error');
  }
}
async function refreshSnapshot() {
  if(!session||saving||refreshing||loggingOut)return;
  captureDraft();const selected=selectedId, ticket=++listEpoch, identity=sessionEpoch;
  detailEpoch++;records=[];detail=null;detailPhase=selected?'loading':'idle';phase='loading';refreshing=true;render();if(selected)renderDetail();
  try {
    const [fresh,team]=await Promise.all([client.loadInquiries(),client.loadMembers()]);
    if(ticket!==listEpoch||identity!==sessionEpoch)return;
    if(!Array.isArray(team)||team.some(member=>!ID.test(member.id||'')||typeof member.name!=='string'))throw new Error('invalid_members');
    records=fresh;members=team;phase='ready';refreshing=false;render();
    // Conflicted drafts remain blocked until the exact inquiry is fetched below.
    if(selectedId)await openDetail(selectedId,{capture:false});else route();
  } catch(error) {
    if(ticket!==listEpoch||identity!==sessionEpoch||ignored(error)||authFailure(error))return;
    records=[];members=[];phase='error';refreshing=false;detail=null;
    if(dialog.open)dialog.close();$('detail-content').replaceChildren();render();
  }
}
async function openDetail(id,{capture=true}={}) {
  if(!session||phase!=='ready'||saving||loggingOut||!ID.test(id))return;
  if(capture)captureDraft();selectedId=id;detail=null;detailPhase='loading';
  const ticket=++detailEpoch,identity=sessionEpoch;renderDetail();
  try {
    const record=await client.getInquiry(id);
    if(ticket!==detailEpoch||identity!==sessionEpoch||selectedId!==id)return;
    detail=record;detailPhase='ready';
    if(needsReview.has(id)&&!stale()) {
      needsReview.delete(id);notices.set(id,{info:true,message:'The latest saved version is loaded. Your unsaved edits are kept. Compare them with the saved record before saving again.'});
    }
    renderDetail();
  } catch(error) {
    if(ticket!==detailEpoch||identity!==sessionEpoch||ignored(error)||authFailure(error))return;
    detail=null;detailPhase='error';renderDetail();
  }
}
async function save(kind) {
  if(!canWrite()||!selectedId||!detail)return;
  captureDraft();const id=selectedId,record=detail,draft={...draftFor(id)},identity=sessionEpoch;
  const text=draft.text?.trim();
  if(kind==='note'&&(!text||text.length>2000))return;
  const patch={version:record.version};
  if('status'in draft&&draft.status!==record.status)patch.status=draft.status;
  if('assigneeId'in draft&&draft.assigneeId!==record.assigneeId)patch.assigneeId=draft.assigneeId;
  if(kind==='workflow'&&Object.keys(patch).length===1)return;
  saving={id,kind};notices.delete(id);render();renderDetail();
  try {
    const saved=kind==='workflow'?await client.updateInquiry(id,patch):await client.addNote(id,{version:record.version,text});
    if(identity!==sessionEpoch)return;
    const remaining={...draftFor(id)};
    if(kind==='workflow'){delete remaining.status;delete remaining.assigneeId;}else{remaining.text='';delete remaining.uncertainNote;}
    drafts.set(id,remaining);records=records.map(item=>item.id===id?saved:item);
    if(selectedId===id){detail=saved;detailPhase='ready';}
    notices.set(id,{info:true,message:kind==='workflow'?'Workflow saved to the staging server.':'Internal note saved to the staging server.'});
    toast(kind==='workflow'?'Workflow saved.':'Internal note saved.');
  } catch(error) {
    if(identity!==sessionEpoch||ignored(error)||authFailure(error))return;
    const uncertain=['connection_failed','invalid_mutation_response','invalid_response'].includes(error.code)||error.status>=500;
    if(error.status===409||error.code==='refresh_required'||uncertain){
      needsReview.add(id);
      if(kind==='note'&&uncertain)drafts.set(id,{...draftFor(id),uncertainNote:{text,ids:record.notes.map(note=>note.id)}});
    }
    const message=error.status===409?'This inquiry changed, or this action is no longer allowed. Your draft is kept. Refresh and review the latest record before saving again.':uncertain?'The save couldn’t be confirmed. It may have reached the server. Your draft is kept. Refresh and check the saved record before trying again.':error.code==='refresh_required'?'This snapshot is out of date. Your draft is kept. Refresh and review before saving.':'The server did not accept this change. Your draft is kept. Check the fields and try again.';
    notices.set(id,{message});
  } finally {
    if(identity===sessionEpoch){saving=null;if(pendingVerification){pendingVerification=false;void verifyCurrentSession();}else{render();if(selectedId&&detail)renderDetail();else route();}}
  }
}
async function signOut() {
  if(!session||saving||loggingOut)return;
  authChannel?.postMessage({type:'auth-changed'});
  loggingOut=true;sessionEpoch++;listEpoch++;detailEpoch++;refreshing=false;captureDraft();closeDialog();records=[];members=[];drafts.clear();notices.clear();needsReview.clear();clearToast();phase='loading';render();
  try {
    const result=await client.logout();
    clearPrivateState('signed-out');
    if(result.redirectUrl) {
      const destination=safeLogoutDestination(result.redirectUrl,location.origin);
      if(destination)location.assign(destination);
      else toast('Signed out of this workspace. The provider sign-out link was not recognized.');
    }
  } catch(error) {
    if(expired(error)){clearPrivateState('signed-out');return;}
    loggingOut=false;phase='logout-error';render();
  }
}
function route() {
  if(location.hash==='#main'){main.focus();return;}
  const match=location.hash.match(/^#inbox\/inquiry\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})$/);
  const id=match?.[1]||null;const nextView=location.hash==='#guide'?'guide':'inbox';
  if(nextView!==view){view=nextView;render();}
  if(!id){const previous=returnFocusId||selectedId;returnFocusId=null;closeDialog();if(phase==='ready')render();if(previous)requestAnimationFrame(()=>{const row=main.querySelector(`[data-open="${previous}"]`);(row||main).focus();});return;}
  if(phase==='ready'&&id!==selectedId){if(saving)closeDialog();else void openDetail(id);}
}
function dismissDetail() {
  returnFocusId=selectedId;closeDialog();
  if(openedFromRow&&/^#inbox\/inquiry\//.test(location.hash)){openedFromRow=false;history.back();}
  else{history.replaceState(null,'','#inbox');route();}
}


for(const element of document.querySelectorAll('[data-icon]'))element.innerHTML=icon(element.dataset.icon);
$('sign-out').addEventListener('click',()=>void signOut());
document.addEventListener('click',event=>{
  const target=event.target.closest('button,a');if(!target)return;
  if(target.disabled)return;
  if(target.hasAttribute('data-open')){openedFromRow=true;location.hash=`inbox/inquiry/${target.dataset.open}`;}
  else if(target.hasAttribute('data-close'))dismissDetail();
  else if(target.hasAttribute('data-refresh'))void refreshSnapshot();
  else if(target.hasAttribute('data-retry-session'))void boot();
  else if(target.hasAttribute('data-logout'))void signOut();
  else if(target.hasAttribute('data-retry-detail'))void openDetail(selectedId);
  else if(target.hasAttribute('data-save-workflow'))void save('workflow');
  else if(target.hasAttribute('data-save-note'))void save('note');
  else if(target.hasAttribute('data-clear-note')){captureDraft();const draft={...draftFor(selectedId),text:''};delete draft.uncertainNote;drafts.set(selectedId,draft);renderDetail();}
  else if(target.hasAttribute('data-filter')){filter=target.dataset.filter;render();}
  else if(target.hasAttribute('data-clear-filters')){filter='all';query='';render();}
  else if(target.hasAttribute('data-guide'))location.hash='guide';
});
main.addEventListener('input',event=>{if(event.target.id==='inquiry-search'){query=event.target.value;$('list-results').innerHTML=listResults();}});
dialog.addEventListener('input',updateFormButtons);dialog.addEventListener('change',updateFormButtons);
dialog.addEventListener('cancel',event=>{event.preventDefault();dismissDetail();});
window.addEventListener('hashchange',route);
window.addEventListener('pageshow',event=>{if(event.persisted)void boot();});
window.addEventListener('focus',()=>void verifyCurrentSession());
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void verifyCurrentSession();});
if(authChannel)authChannel.onmessage=event=>{if(event.data?.type==='auth-changed')clearPrivateState('expired');};
// Remove private DOM from the back/forward cache before another document is shown.
window.addEventListener('pagehide',()=>clearPrivateState('session-loading'));
setInterval(()=>{
  if(phase!=='ready'||lastStale===stale())return;
  captureDraft();render();if(selectedId&&detail)renderDetail();
},1000);
void boot();
