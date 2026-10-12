/** Connected UI acceptance with real API DTO/security service and synthetic loopback store.
 * No provider, production endpoint or credential is used. No remote target option exists.
 */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createStagingHarness} from './staging-harness.mjs';
const require=createRequire(new URL('../../qa/reporting-browser/package.json',import.meta.url));
const {chromium,expect}=require('@playwright/test');
const evidence=fileURLToPath(new URL('./staging-evidence/',import.meta.url));
await mkdir(evidence,{recursive:true});
const results=[],errors=[],external=[];
let harness,browser,page;
async function check(name,fn){await fn();results.push({name,status:'passed'});console.log(`PASS ${name}`);}
async function shot(name,fullPage=true){
  // Full-page capture must start at the document origin so fixed navigation and
  // the intentionally offscreen skip link are not composited at a stale scroll offset.
  await page.evaluate(()=>{
    if(!document.querySelector('dialog[open]'))document.querySelector('main')?.focus({preventScroll:true});
    window.scrollTo(0,0);
  });
  await page.screenshot({path:path.join(evidence,name),fullPage,animations:'disabled'});
}
async function ready(){await page.getByRole('heading',{name:'A clear view of what’s next.'}).waitFor();}
async function open(id='inquiry-a'){await page.locator(`#list-results [data-open="${id}"]`).click();await expect(page.locator('#detail-title')).not.toHaveText('Loading inquiry…');await page.getByLabel('Internal note',{exact:true}).waitFor();}
async function close(){await page.getByRole('button',{name:'Close inquiry',exact:true}).click();await page.locator('dialog[open]').waitFor({state:'detached'});}
async function reload(){await page.goto(`${harness.origin}/portal`);await ready();}
async function reset(){harness.reset();await reload();}
try {
  harness=await createStagingHarness();
  browser=await chromium.launch({headless:true,...(process.env.PORTAL_CHROMIUM?{executablePath:process.env.PORTAL_CHROMIUM}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(!request.url().startsWith(harness.origin)&&!request.url().startsWith('data:'))external.push(request.url());});
  await check('anonymous session gates data and offers provider login without token inputs',async()=>{
    harness.state.authenticated=false;await page.goto(`${harness.origin}/portal`);
    await page.getByRole('heading',{name:'Your workspace, one sign-in away.'}).waitFor();
    await expect(page.getByRole('link',{name:'Sign in with Wix'})).toHaveAttribute('href','/api/auth/login');
    assert.equal(harness.state.requests.filter(request=>request.path.endsWith('/inquiries')).length,0);
    assert.equal(await page.locator('.inquiry-row,input,textarea').count(),0);
    await shot('anonymous.png');
  });
  await check('session-loading state has no records or metrics',async()=>{
    harness.reset();harness.state.sessionDelay=600;await page.goto(`${harness.origin}/portal`);
    await page.getByRole('heading',{name:'Checking your session…'}).waitFor();
    assert.equal(await page.locator('.metric-value,.inquiry-row').count(),0);await ready();harness.state.sessionDelay=0;
  });
  await check('bounded snapshot uses only actual DTO fields and no financial claims',async()=>{
    assert.match(await page.locator('.staging-banner').innerText(),/Staging • Synthetic records/);
    assert.equal(await page.locator('#list-results .inquiry-row').count(),2);
    assert.deepEqual(await page.locator('.metric-value').allTextContents(),['2','1','3']);
    assert.match(await page.locator('.snapshot-notice').innerText(),/up to 100/);
    assert.equal(await page.locator('input[type=password],input[name=tenant],input[name=token]').count(),0);
    assert.doesNotMatch(await page.locator('main').innerText(),/\$|Confirmed revenue|Potential.*value/);
    assert.equal(await page.getByRole('link',{name:'Outcomes',exact:true}).count(),0);
    assert.doesNotMatch(await page.locator('body').innerText(),/Never display this foreign record/);
    await shot('desktop-inbox.png');
  });
  await check('search, filters and empty matches use the loaded snapshot',async()=>{
    await page.getByLabel('Search loaded inquiries').fill('Taylor');await expect(page.locator('#list-results .inquiry-row')).toHaveCount(1);
    await page.getByLabel('Search loaded inquiries').fill('not-present');await page.getByRole('heading',{name:'No matching inquiries'}).waitFor();
    await page.getByRole('button',{name:'Clear filters',exact:true}).click();await expect(page.locator('#list-results .inquiry-row')).toHaveCount(3);
    await page.getByRole('button',{name:'Closed',exact:true}).click();await expect(page.locator('#list-results .inquiry-row')).toHaveCount(1);
    await page.getByRole('button',{name:'All loaded',exact:true}).click();
  });
  await check('detail loads from API, saves workflow, and persists after browser reload',async()=>{
    await open();assert.equal(harness.state.requests.filter(request=>request.path.endsWith('/inquiry-a')&&request.method==='GET').length,1);
    await page.getByLabel('Status',{exact:true}).selectOption('in_progress');await page.getByLabel('Assigned to').selectOption('owner');
    await page.getByRole('button',{name:'Save workflow',exact:true}).click();await page.getByText('Workflow saved to the staging server.',{exact:true}).waitFor();
    const request=harness.state.requests.find(request=>request.method==='PATCH');assert.deepEqual(request.body,{version:1,status:'in_progress',assigneeId:'owner'});
    assert.equal(harness.state.audits.length,1);await reload();await open();
    assert.equal(await page.getByLabel('Status',{exact:true}).inputValue(),'in_progress');assert.equal(await page.getByLabel('Assigned to').inputValue(),'owner');
  });
  await check('notes stay literal and pending duplicate clicks produce one audited save',async()=>{
    harness.state.writeDelay=400;await page.getByLabel('Internal note',{exact:true}).fill('<img src=x onerror=alert(1)> Call after lunch.');
    await page.getByRole('button',{name:'Add note',exact:true}).dispatchEvent('click');await page.getByRole('button',{name:'Saving…',exact:true}).dispatchEvent('click');
    await page.getByText('Internal note saved to the staging server.',{exact:true}).waitFor();
    assert.equal(await page.locator('.note').count(),1);assert.equal(await page.locator('.note img').count(),0);
    assert.match(await page.locator('.note').innerText(),/<img/);assert.equal(harness.state.audits.length,2);harness.state.writeDelay=0;
    await shot('desktop-inquiry.png',false);
  });
  await check('draft survives Escape and focus returns without leaking to another inquiry',async()=>{
    await page.getByLabel('Internal note',{exact:true}).fill('Draft for Jamie only');await page.keyboard.press('Escape');await page.locator('dialog[open]').waitFor({state:'detached'});
    await expect(page.locator(':focus')).toHaveAttribute('data-open','inquiry-a');await open('inquiry-b');
    assert.equal(await page.getByLabel('Internal note',{exact:true}).inputValue(),'');await close();await open();
    assert.equal(await page.getByLabel('Internal note',{exact:true}).inputValue(),'Draft for Jamie only');await close();
  });
  await check('Back and Forward restore the selected inquiry and its own draft',async()=>{
    await open();await page.goBack();await page.locator('dialog[open]').waitFor({state:'detached'});await page.goForward();
    await page.getByLabel('Internal note',{exact:true}).waitFor();await expect(page.locator('#detail-title')).toHaveText('AC running, but not cooling');
    assert.equal(await page.getByLabel('Internal note',{exact:true}).inputValue(),'Draft for Jamie only');await close();
  });
  await check('slow old detail cannot replace a newer selected record',async()=>{
    harness.state.detailDelays['inquiry-a']=700;await page.locator('#list-results [data-open="inquiry-a"]').click();
    await page.getByRole('heading',{name:'Loading inquiry…'}).waitFor();await close();await open('inquiry-b');
    await page.waitForTimeout(850);await expect(page.locator('#detail-title')).toHaveText('Follow-up on heat pump estimate');
    assert.equal(await page.getByLabel('Internal note',{exact:true}).inputValue(),'');await close();harness.state.detailDelays={};
  });
  await check('concurrent conflict preserves draft, blocks retry and requires refreshed review',async()=>{
    await open();await page.getByLabel('Status',{exact:true}).selectOption('waiting');await page.getByLabel('Internal note',{exact:true}).fill('Retain conflict note');
    harness.state.records.find(record=>record.id==='inquiry-a').version++;
    await page.getByRole('button',{name:'Save workflow',exact:true}).click();await page.getByText(/This inquiry changed, or this action/).waitFor();
    assert.equal(await page.getByLabel('Status',{exact:true}).inputValue(),'waiting');assert.equal(await page.getByLabel('Internal note',{exact:true}).inputValue(),'Retain conflict note');
    assert.equal(await page.getByRole('button',{name:'Save workflow',exact:true}).isDisabled(),true);
    await page.getByRole('button',{name:'Refresh and review',exact:true}).click();await page.getByText(/The latest saved version is loaded/).waitFor();
    assert.equal(await page.getByLabel('Status',{exact:true}).inputValue(),'waiting');await page.getByRole('button',{name:'Save workflow',exact:true}).click();
    await page.getByText('Workflow saved to the staging server.',{exact:true}).waitFor();await close();
  });
  await check('uncertain note commit is reconciled and cannot be silently duplicated',async()=>{
    await open();harness.state.uncertainCommit=true;await page.getByLabel('Internal note',{exact:true}).fill('Possibly committed note');
    await page.getByRole('button',{name:'Add note',exact:true}).click();await page.getByText(/The save couldn’t be confirmed/).waitFor();
    assert.equal(await page.getByRole('button',{name:'Add note',exact:true}).isDisabled(),true);
    await page.getByRole('button',{name:'Refresh and review',exact:true}).click();await page.getByText(/A matching note is now/).waitFor();
    assert.equal(await page.locator('.note').filter({hasText:'Possibly committed note'}).count(),1);
    assert.equal(await page.getByRole('button',{name:'Add note',exact:true}).isDisabled(),true);
    await page.getByRole('button',{name:'Clear note draft',exact:true}).click();assert.equal(await page.getByLabel('Internal note',{exact:true}).inputValue(),'');await close();
  });
  await check('failed save keeps draft and reports no fabricated success',async()=>{
    await open();harness.state.failWrite=true;await page.getByLabel('Internal note',{exact:true}).fill('Keep after failed save');
    const notes=harness.state.records.find(record=>record.id==='inquiry-a').notes.length;
    await page.getByRole('button',{name:'Add note',exact:true}).click();await page.getByText(/The save couldn’t be confirmed/).waitFor();
    assert.equal(await page.getByLabel('Internal note',{exact:true}).inputValue(),'Keep after failed save');assert.equal(harness.state.records.find(record=>record.id==='inquiry-a').notes.length,notes);
    harness.state.failWrite=false;await page.getByRole('button',{name:'Refresh and review',exact:true}).click();await page.getByText(/The latest saved version is loaded/).waitFor();
    await page.getByRole('button',{name:'Add note',exact:true}).click();await page.getByText('Internal note saved to the staging server.',{exact:true}).waitFor();await close();
  });
  await check('stale snapshot becomes read-only and refresh retains draft',async()=>{
    await page.clock.install();await reload();await open();await page.getByLabel('Internal note',{exact:true}).fill('Keep stale draft');
    await page.clock.fastForward(62000);await page.getByText(/This snapshot is out of date/).waitFor();
    assert.equal(await page.getByRole('button',{name:'Add note',exact:true}).isDisabled(),true);
    await page.getByRole('button',{name:'Refresh and review',exact:true}).click();await page.getByLabel('Internal note',{exact:true}).waitFor();
    assert.equal(await page.getByLabel('Internal note',{exact:true}).inputValue(),'Keep stale draft');assert.equal(await page.getByRole('button',{name:'Add note',exact:true}).isDisabled(),false);await close();
  });
  await check('session expiry immediately clears records, counts, private details and drafts',async()=>{
    await open();await page.getByLabel('Internal note',{exact:true}).fill('Do not retain expired draft');harness.state.authenticated=false;await close();
    await page.getByRole('button',{name:'Refresh snapshot',exact:true}).click();await page.getByRole('heading',{name:'Your session has ended.'}).waitFor();
    assert.equal(await page.locator('.metric-value,.inquiry-row,.note,textarea,dialog[open]').count(),0);assert.equal(await page.locator('#detail-content').innerText(),'');
    assert.doesNotMatch(await page.locator('body').innerText(),/Jamie|Taylor|Do not retain expired draft/);
    harness.state.authenticated=true;await reload();await open();assert.equal(await page.getByLabel('Internal note',{exact:true}).inputValue(),'');await close();
  });
  await check('new account cookie cannot mix same-ID records with the old account draft',async()=>{
    await reset();await open();await page.getByLabel('Internal note',{exact:true}).fill('Account A draft only');await close();harness.state.account='b';
    await page.getByRole('button',{name:'Refresh snapshot',exact:true}).click();await page.getByRole('heading',{name:'Your session has ended.'}).waitFor();
    assert.doesNotMatch(await page.locator('body').innerText(),/Account B customer|Same ID from account B|Account A draft only/);
    assert.equal(await page.locator('.inquiry-row,.metric-value,textarea').count(),0);
    await reload();await open();await expect(page.locator('#detail-title')).toHaveText('Same ID from account B');assert.equal(await page.getByLabel('Internal note',{exact:true}).inputValue(),'');await close();
  });
  await check('focus revalidation preserves drafts only for the same server session',async()=>{
    await reset();await open();await page.getByLabel('Internal note',{exact:true}).fill('Same-session draft');
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByLabel('Internal note',{exact:true}).waitFor();
    assert.equal(await page.getByLabel('Internal note',{exact:true}).inputValue(),'Same-session draft');
    harness.state.account='b';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByRole('heading',{name:'Your session has ended.'}).waitFor();
    assert.equal(await page.locator('textarea,.inquiry-row,.metric-value').count(),0);
  });
  await check('cross-tab auth-change signal immediately clears an inactive tab and its drafts',async()=>{
    await reset();await open();await page.getByLabel('Internal note',{exact:true}).fill('Clear inactive tab draft');
    const other=await page.context().newPage();await other.goto(`${harness.origin}/api/auth/login`);harness.state.account='b';
    await other.evaluate(async()=>{const channel=new BroadcastChannel('bookedradar-portal-auth');channel.postMessage({type:'auth-changed'});await new Promise(resolve=>setTimeout(resolve,100));channel.close();});
    await page.getByRole('heading',{name:'Your session has ended.'}).waitFor();assert.equal(await page.locator('textarea,.inquiry-row,.metric-value,dialog[open]').count(),0);
    await other.close();await page.bringToFront();await expect(page.getByRole('heading',{name:'Your session has ended.'})).toBeVisible();
  });
  await check('read-only membership cannot edit or issue mutations',async()=>{
    harness.reset();harness.state.viewer=true;await reload();await open();
    for(const label of ['Status','Assigned to','Internal note'])assert.equal(await page.getByLabel(label,{exact:true}).isDisabled(),true);
    assert.equal(await page.getByRole('button',{name:'Save workflow',exact:true}).isDisabled(),true);
    assert.equal(harness.state.requests.filter(request=>['POST','PATCH'].includes(request.method)).length,0);await close();
  });
  await check('loading refresh and errors never retain old inquiry rows or counts',async()=>{
    await reset();harness.state.listDelay=650;await page.getByRole('button',{name:'Refresh snapshot',exact:true}).click();
    await page.getByRole('heading',{name:'Loading your workspace…'}).waitFor();assert.equal(await page.locator('.metric-value,.inquiry-row').count(),0);await ready();
    harness.state.listDelay=0;harness.state.failList=true;await page.getByRole('button',{name:'Refresh snapshot',exact:true}).click();
    await page.getByRole('heading',{name:'No current records to show'}).waitFor();assert.equal(await page.locator('.metric-value,.inquiry-row').count(),0);
    harness.state.failList=false;await page.getByRole('button',{name:'Try again',exact:true}).click();await ready();
  });
  await check('empty server snapshot shows a real zero result',async()=>{
    harness.state.empty=true;await page.getByRole('button',{name:'Refresh snapshot',exact:true}).click();
    await page.getByRole('heading',{name:'No inquiries in this snapshot'}).waitFor();assert.deepEqual(await page.locator('.metric-value').allTextContents(),['0','0','0']);harness.state.empty=false;
  });
  await check('cross-tenant detail lookup fails without a stale record or private fields',async()=>{
    await reset();await page.goto(`${harness.origin}/portal#inbox/inquiry/foreign-inquiry`);
    await page.getByRole('heading',{name:'This inquiry couldn’t be loaded.'}).waitFor();assert.doesNotMatch(await page.locator('body').innerText(),/Never display this foreign record|Other workspace customer/);
    assert.equal(await page.locator('#detail-content textarea').count(),0);await close();
  });
  await check('logout uses server CSRF and clears workspace',async()=>{
    await reload();await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.getByRole('heading',{name:'You’re signed out.'}).waitFor();
    const logout=harness.state.requests.filter(request=>request.path==='/api/auth/logout').at(-1);
    assert.equal(logout.method,'POST');assert.equal(logout.headers.origin,harness.origin);assert.equal(typeof logout.headers['x-csrf-token'],'string');assert.deepEqual(logout.body,{});
    assert.equal(await page.locator('.inquiry-row,.metric-value,textarea').count(),0);assert.equal(harness.state.authenticated,false);
  });
  await check('logout failure hides private records and offers an honest retry',async()=>{
    await reset();harness.state.logoutFail=true;await page.getByRole('button',{name:'Sign out',exact:true}).click();
    await page.getByRole('heading',{name:'Sign-out couldn’t be confirmed.'}).waitFor();assert.equal(await page.locator('.inquiry-row,.metric-value,textarea').count(),0);
    harness.state.logoutFail=false;await page.getByRole('button',{name:'Retry sign out',exact:true}).click();await page.getByRole('heading',{name:'You’re signed out.'}).waitFor();
  });
  await check('logout fences delayed list and members both before and after failed sign-out',async()=>{
    for(const readDelay of [250,750]){
      await reset();harness.state.listDelay=readDelay;harness.state.memberDelay=readDelay;harness.state.logoutDelay=450;harness.state.logoutFail=true;
      await page.getByRole('button',{name:'Refresh snapshot',exact:true}).click();await page.getByRole('heading',{name:'Loading your workspace…'}).waitFor();
      await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.getByRole('heading',{name:'Sign-out couldn’t be confirmed.'}).waitFor();
      await page.waitForTimeout(850);await expect(page.getByRole('heading',{name:'Sign-out couldn’t be confirmed.'})).toBeVisible();
      assert.equal(await page.locator('.inquiry-row,.metric-value,textarea,dialog[open]').count(),0);
      harness.state.logoutFail=false;await page.getByRole('button',{name:'Retry sign out',exact:true}).click();await page.getByRole('heading',{name:'You’re signed out.'}).waitFor();
    }
  });
  await check('logout fences delayed inquiry details after dismissal',async()=>{
    await reset();harness.state.detailDelays['inquiry-a']=700;
    await page.locator('#list-results [data-open="inquiry-a"]').click();await page.getByRole('heading',{name:'Loading inquiry…'}).waitFor();await close();
    await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.getByRole('heading',{name:'You’re signed out.'}).waitFor();await page.waitForTimeout(850);
    assert.equal(await page.locator('.inquiry-row,.metric-value,textarea,dialog[open]').count(),0);assert.equal(await page.locator('#detail-content').innerText(),'');
  });
  await reset();
  for(const width of [320,375,390,768,1440])await check(`responsive ${width}px layout, focus trap and no document or dialog overflow`,async()=>{
    await page.setViewportSize({width,height:950});await ready();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);await shot(`inbox-${width}.png`);
    await open();assert.equal(await page.locator('dialog').evaluate(element=>element.scrollWidth<=element.clientWidth),true);await shot(`inquiry-${width}.png`,false);
    await page.getByRole('button',{name:'Close inquiry',exact:true}).focus();await page.keyboard.press('Shift+Tab');assert.equal(await page.locator('dialog').evaluate(element=>element.contains(document.activeElement)),true);
    await page.keyboard.press('Escape');await page.locator('dialog[open]').waitFor({state:'detached'});await expect(page.locator(':focus')).toHaveAttribute('data-open','inquiry-a');
  });
  await check('no external requests, uncaught JavaScript, browser tenant authority or secret storage',async()=>{
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    for(const request of harness.state.requests){assert.equal(request.headers.authorization,undefined);assert.equal(Object.keys(request.headers).some(key=>key.includes('tenant')),false);if(request.body)assert.equal(Object.keys(request.body).some(key=>key.toLowerCase().includes('tenant')),false);}
    assert.deepEqual(await page.evaluate(()=>({local:Object.keys(localStorage),session:Object.keys(sessionStorage)})),{local:[],session:[]});
  });
  console.log(`${results.length} connected staging browser checks passed`);
} catch(error) {
  await page?.screenshot({path:path.join(evidence,'failure.png'),fullPage:true}).catch(()=>{});console.error(error);process.exitCode=1;results.push({status:'failed',error:String(error)});
} finally {
  await writeFile(path.join(evidence,'results.json'),JSON.stringify({scope:'Synthetic loopback API service and connected UI only. No real Wix login or persistent database is exercised by this suite.',results},null,2));
  await browser?.close();await harness?.close();
}
