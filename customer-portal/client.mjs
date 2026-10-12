/** Same-origin transport used only by the explicitly enabled staging UI.
 * The demo does not import this module. No administrator token or tenant selector.
 */
const PREFIX='/api/customer-portal/v1';
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
export class PortalClientError extends Error {
  constructor(code,status=0){super(code);this.name='PortalClientError';this.code=code;this.status=status;}
}
export function createPortalClient({fetchImpl=globalThis.fetch,now=()=>Date.now(),maxAgeMs=60000}={}){
  if(typeof fetchImpl!=='function')throw new TypeError('fetch is required');
  let epoch=0,session=null,csrfToken=null,snapshot=null,loadedAt=null;
  const active=new Map(),knownVersions=new Map();
  const hasWrite=()=>[...active.keys()].some(key=>key.startsWith('write:'));
  const invalidateReads=()=>{for(const key of ['inquiries','detail']){active.get(key)?.controller.abort();active.delete(key);}};
  const verifyVersion=record=>{if(!record||!ID.test(record.id||'')||!Number.isSafeInteger(record.version)||record.version<1)throw new PortalClientError('invalid_inquiry_response');if(record.version<(knownVersions.get(record.id)||0)){loadedAt=null;throw new PortalClientError('stale_response');}};
  const remember=record=>knownVersions.set(record.id,record.version);
  const clear=()=>{epoch++;for(const request of active.values())request.controller.abort();active.clear();session=null;csrfToken=null;snapshot=null;loadedAt=null;knownVersions.clear();};
  async function request(path,{method='GET',body,key=path,auth=false}={}){
    const capturedEpoch=epoch,controller=new AbortController(),ticket={controller};
    active.get(key)?.controller.abort();active.set(key,ticket);
    try{
      const response=await fetchImpl(`${auth?'/api/auth':PREFIX}${path}`,{method,credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal,headers:{Accept:'application/json',...(csrfToken?{'X-CSRF-Token':csrfToken}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
      if(epoch!==capturedEpoch||active.get(key)!==ticket)throw new PortalClientError('superseded');
      if(response.status===401||response.status===403){clear();throw new PortalClientError('session_unavailable',response.status);}
      const value=await response.json();
      if(epoch!==capturedEpoch||active.get(key)!==ticket)throw new PortalClientError('superseded');
      if(!response.ok){if(response.status===409||(body&&response.status>=500))loadedAt=null;throw new PortalClientError(value?.error||'request_failed',response.status);}
      if(!value||value.ok!==true){if(body)loadedAt=null;throw new PortalClientError('invalid_response');}
      return value;
    }catch(error){if(body&&!(error instanceof PortalClientError))loadedAt=null;if(error instanceof PortalClientError)throw error;if(epoch!==capturedEpoch||controller.signal.aborted)throw new PortalClientError('superseded');throw new PortalClientError('connection_failed');}
    finally{if(active.get(key)===ticket)active.delete(key);}
  }
  const requireSession=()=>{if(!session)throw new PortalClientError('session_required');};
  const idPath=id=>{if(typeof id!=='string'||!ID.test(id))throw new PortalClientError('invalid_id');return `/inquiries/${encodeURIComponent(id)}`;};
  const requireWrite=version=>{requireSession();if(!session.canEdit||!csrfToken)throw new PortalClientError('read_only');if(!Number.isSafeInteger(version)||version<1)throw new PortalClientError('version_required');if(loadedAt===null||now()-loadedAt>maxAgeMs)throw new PortalClientError('refresh_required');};
  return {
    state:()=>({session:session?structuredClone(session):null,snapshot:snapshot?structuredClone(snapshot):null,loadedAt,stale:loadedAt===null||now()-loadedAt>maxAgeMs}),
    clear,
    async loadSession(){
      clear();const value=await request('/session');const s=value.session;
      if(!s||!ID.test(s.userId||'')||!ID.test(s.memberId||'')||!ID.test(s.tenant?.id||'')||!['viewer','operator'].includes(s.role)||typeof s.canEdit!=='boolean')throw new PortalClientError('invalid_session_response');
      session=structuredClone(s);csrfToken=typeof value.csrfToken==='string'?value.csrfToken:null;return structuredClone(session);
    },
    async revalidateSession(){
      requireSession();
      if(hasWrite())throw new PortalClientError('save_in_progress');
      // Stop old reads, but retain identity and drafts until the same session is proven.
      epoch++;for(const request of active.values())request.controller.abort();active.clear();snapshot=null;loadedAt=null;
      const previous=session,previousCsrf=csrfToken;
      const value=await request('/session'),next=value.session;
      if(!next||next.userId!==previous.userId||next.memberId!==previous.memberId||next.tenant?.id!==previous.tenant.id||value.csrfToken!==previousCsrf||!['viewer','operator'].includes(next.role)||typeof next.canEdit!=='boolean'){
        clear();throw new PortalClientError('session_unavailable',401);
      }
      session=structuredClone(next);return structuredClone(session);
    },
    async logout(){
      requireSession();
      if(hasWrite())throw new PortalClientError('save_in_progress');
      if(!csrfToken)throw new PortalClientError('session_required');
      // Fence every pending read while keeping only the session/CSRF needed to end it.
      epoch++;for(const request of active.values())request.controller.abort();active.clear();snapshot=null;loadedAt=null;knownVersions.clear();
      const value=await request('/logout',{method:'POST',body:{},key:'logout',auth:true});
      clear();return {redirectUrl:typeof value.redirectUrl==='string'?value.redirectUrl:null};
    },
    async loadInquiries(){requireSession();if(hasWrite())throw new PortalClientError('save_in_progress');snapshot=null;loadedAt=null;const value=await request('/inquiries',{key:'inquiries'});if(!Array.isArray(value.inquiries)||!Number.isSafeInteger(value.limit)||value.limit<1||value.limit>100||value.inquiries.length>value.limit)throw new PortalClientError('invalid_inquiry_response');value.inquiries.forEach(verifyVersion);value.inquiries.forEach(remember);snapshot=structuredClone(value.inquiries);loadedAt=now();return structuredClone(snapshot);},
    async loadMembers(){requireSession();const value=await request('/members');if(!Array.isArray(value.members))throw new PortalClientError('invalid_member_response');return structuredClone(value.members);},
    async getInquiry(id){requireSession();if(hasWrite())throw new PortalClientError('save_in_progress');const value=await request(idPath(id),{key:'detail'});if(!value.inquiry||value.inquiry.id!==id)throw new PortalClientError('invalid_inquiry_response');verifyVersion(value.inquiry);remember(value.inquiry);return structuredClone(value.inquiry);},
    async updateInquiry(id,{version,status,assigneeId}){
      requireWrite(version);const body={version};if(status!==undefined)body.status=status;if(assigneeId!==undefined)body.assigneeId=assigneeId;
      const key=`write:${id}`;if(hasWrite())throw new PortalClientError('save_in_progress');invalidateReads();
      const value=await request(idPath(id),{method:'PATCH',body,key});if(!value.inquiry||value.inquiry.id!==id||value.inquiry.version!==version+1){loadedAt=null;throw new PortalClientError('invalid_mutation_response');}
      verifyVersion(value.inquiry);remember(value.inquiry);snapshot=snapshot?.map(x=>x.id===id?structuredClone(value.inquiry):x)||null;return structuredClone(value.inquiry);
    },
    async addNote(id,{version,text}){
      requireWrite(version);const key=`write:${id}`;if(hasWrite())throw new PortalClientError('save_in_progress');invalidateReads();
      const value=await request(`${idPath(id)}/notes`,{method:'POST',body:{version,text},key});if(!value.inquiry||value.inquiry.id!==id||value.inquiry.version!==version+1){loadedAt=null;throw new PortalClientError('invalid_mutation_response');}
      verifyVersion(value.inquiry);remember(value.inquiry);snapshot=snapshot?.map(x=>x.id===id?structuredClone(value.inquiry):x)||null;return structuredClone(value.inquiry);
    }
  };
}

/** Accept only the pilot's fixed provider logout and the local logout callback. */
export function safeLogoutDestination(value, origin) {
  if(typeof value!=='string')return null;
  try {
    const url=new URL(value,origin);
    if(url.username||url.password||url.hash)return null;
    if(url.origin===origin&&url.pathname==='/api/auth/logout-callback'&&!url.search)return url.href;
    const callback='https://bookedradar-private-voice-lab-20260929.onrender.com/api/auth/logout-callback';
    if(url.origin!=='https://www.wixapis.com'||url.pathname!=='/_api/iam/authentication/v1/logout')return null;
    if([...url.searchParams.keys()].length!==2||url.searchParams.getAll('clientId').length!==1||url.searchParams.getAll('postLogoutRedirectUri').length!==1)return null;
    if(url.searchParams.get('clientId')!=='f6191cf3-548f-4883-98a4-27cdd0fcff3a'||url.searchParams.get('postLogoutRedirectUri')!==callback)return null;
    return url.href;
  } catch { return null; }
}
