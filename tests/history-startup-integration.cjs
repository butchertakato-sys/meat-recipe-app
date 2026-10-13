// Isolated browser origins and an in-memory REST mock. Never contacts production Supabase.
const { chromium } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const id = () => crypto.randomUUID();
const codes = ['ARABIKI','CHEESE','HERB','CHORIZO','ADDITIVE_FREE_ARABIKI','YAMAGOYA','GIBIER_CENTER','TOUGE','ZANZATEI'];
const tables = { products: [], recipes: [], recipe_versions: [], recipe_ingredients: [], packaging_master: [], packaging_versions: [] };
for (const code of codes) {
  const product=id(), recipe=id();
  tables.products.push({id:product,internal_code:code,display_name:code,business_id:'business'});
  if(code!=='TOUGE') {tables.recipes.push({id:recipe,product_id:product,internal_code:code,display_name:code});tables.recipe_versions.push({id:id(),recipe_id:recipe,is_current:true,version_no:1});}
  for(const packageCode of code==='HERB'?['HERB_STANDARD','HERB_EVENT']:[code+'_STANDARD']) {
    const packaging=id();tables.packaging_master.push({id:packaging,product_id:product,internal_code:packageCode,is_active:true});
    tables.packaging_versions.push({id:id(),packaging_master_id:packaging,is_current:true,version_no:1,unit_weight_g:packageCode==='HERB_EVENT'||code==='GIBIER_CENTER'?35:180,package_weight_g:180,units_per_package:4,unit_type:packageCode==='HERB_EVENT'||code==='GIBIER_CENTER'?'piece':'package'});
  }
}
for(let i=0;i<52;i++)tables.recipe_ingredients.push({id:id(),recipe_version_id:tables.recipe_versions[0].id});
const cloud = new Map();const allocations = new Map();let rpcMissing=false;let sends=0;const unexpected=[];const requestLog=[];
function json(route,body,status=200){return route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});}
async function mock(route){
 const req=route.request(),url=new URL(req.url()),table=url.pathname.split('/').pop(),method=req.method();
 if(url.hostname==='app.test') {
   let file=path.join(root,url.pathname==='/'?'index.html':url.pathname);
   try {let body=fs.readFileSync(file);if(file.endsWith('offline-sync.js'))body=body.toString().replace('async function syncPending() {', 'async function syncPending() { (window.syncTrace ||= []).push("syncPending");').replace('async function pullHistoryFromCloud() {','async function pullHistoryFromCloud() { window.pullCalls = (window.pullCalls || 0) + 1;').replace('() => refreshHistoryCache().catch(() => {})','() => (window.onlineSyncPromise = refreshHistoryCache()).catch(() => {})').replace('() => pullHistoryFromCloud().catch(() => {})','() => (window.savePullPromise = pullHistoryFromCloud()).catch(() => {})');if(file.endsWith('index.html'))body=body.toString().replace('    initApp();','    // Controlled initialization in isolated integration tests.');return route.fulfill({body,contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html'});}catch{ return route.abort(); }
 }
 if(url.hostname!=='supabase.test') {if(url.hostname!=='cdn.jsdelivr.net')unexpected.push(req.url());return route.abort();}
 requestLog.push({table,method,body:method==='GET'?null:req.postDataJSON()});
 if(table==='save_manufacturing_record'){
   if(rpcMissing)return json(route,{code:'PGRST202',message:'save_manufacturing_record missing'},404);
   const {record_data:r,allocation_data:a}=req.postDataJSON();assert.ok(r.product_id&&r.recipe_id&&r.recipe_version_id);assert.equal(r.business_id,'business');
   const clean={...r};delete clean.legacy_payload;cloud.set(r.id,clean);for(const [key,row] of allocations)if(row.manufacturing_record_id===r.id)allocations.delete(key);for(const row of a)allocations.set(row.id,row);sends++;return json(route,{id:r.id});
 }
 if(table==='reserve_manufacturing_lot') {const b=req.postDataJSON();return json(route,(cloud.get(b.target_record_id)||{}).lot_number||b.target_lot_base+'-01');}
 if(tables[table])return json(route,tables[table]);
 if(table==='saved_recipe_calculations')return json(route,method==='POST'?[req.postDataJSON()]:[]);
 if(table==='manufacturing_records'){
  if(method==='POST'){const r=req.postDataJSON();assert.ok(r.product_id&&r.recipe_id&&r.recipe_version_id);cloud.set(r.id,r);sends++;return json(route,null,201);}
  const lotFilter=url.searchParams.get('lot_number');
  const lots=lotFilter?JSON.parse('['+lotFilter.slice(4,-1)+']'):null;
  return json(route,[...cloud.values()].filter(r=>!lots||lots.includes(r.lot_number)).map(r=>({...r,manufacturing_allocations:[...allocations.values()].filter(a=>a.manufacturing_record_id===r.id)})));
 }
 if(table==='manufacturing_allocations'){
  if(method==='POST'){for(const r of req.postDataJSON())allocations.set(r.id,r);return json(route,null,201);}
  if(method==='PATCH'){const key=url.searchParams.get('id').slice(3);allocations.set(key,{...allocations.get(key),...req.postDataJSON()});return json(route,null,200);}
  const recordId=(url.searchParams.get('manufacturing_record_id')||'').slice(3);return json(route,[...allocations.values()].filter(a=>a.manufacturing_record_id===recordId));
 }
 unexpected.push(req.url());return json(route,{message:'unexpected request'},500);
}
const base={id:'old-record',lot:'20261008-JI-ARABIKI-01',recipeName:'あらびき',category:'自社レシピ',prepDate:'2026-10-08',date:'2026-10-08',meatTotal:5000,meat6mm:5000,meat3mm:0,totalWeight:6000,theoreticalFinishedWeight:6000,packageCount:25,packagingUnit:'パック',savedUnitWeightG:180,yieldRate:78,finishedWeight:4500,lossCount:0,memo:'archive memo'};
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});const errors=[];
 async function device(raw=false){const context=await browser.newContext({viewport:{width:820,height:1180}});await context.route('**/*',mock);await context.addInitScript(()=>{window.MEAT_SUPABASE_CONFIG={enabled:true,url:'https://supabase.test',publishableKey:'test-key',businessId:'business',accessToken:'test-token'};window.testOnline=false;Object.defineProperty(navigator,'onLine',{get:()=>window.testOnline});});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('http://app.test/');if(!raw)await page.evaluate(async()=>{await initializeManufacturingSync();await initializeSupabaseMasterData();MeatCrossDeviceSync.initialize(MEAT_SUPABASE_CONFIG);});return {context,page};}
 try {
 const results=[];
 const D=await device(true);
 await D.page.evaluate(()=>{
   testOnline=true;window.historyRenders=[];window.integrationStarts=0;window.intervalStarts=[];
   const render=renderManufacturingRecordHistory;renderManufacturingRecordHistory=(rows,...args)=>{historyRenders.push(rows.map(r=>r.id));return render(rows,...args);};
   const sync=MeatCrossDeviceSync.syncAll;MeatCrossDeviceSync.syncAll=(...args)=>{integrationStarts++;return sync(...args);};
   const interval=window.setInterval;window.setInterval=(...args)=>{intervalStarts.push(args[1]);return interval(...args);};
   MeatProductionAuth.initialize=async()=>({session:{access_token:'test-token'}});
 });
 let release;let blocked=0;let gate=new Promise(resolve=>{release=resolve;});
 await D.page.route('https://supabase.test/rest/v1/manufacturing_records**',async route=>{blocked++;await gate;return mock(route);});
 await D.page.evaluate(()=>initApp());
 assert.ok(await D.page.locator('[data-type="category"][data-id="records"]').count()>0,'home remains usable during boot sync');
 await D.page.locator('[data-type="category"][data-id="records"]').click();
 const loading=await D.page.evaluate(()=>{document.querySelector('[data-type="record-history"]').click();return {text:app.textContent.trim(),rows:app.querySelectorAll('[data-type="record-detail"]').length};});
 assert.deepEqual(loading,{text:'製造履歴を読み込み中...',rows:0});
 await D.page.waitForFunction(()=>integrationStarts===1);await D.page.waitForTimeout(50);
 assert.ok(blocked>0);assert.equal(await D.page.evaluate(()=>historyRenders.length),0);
 await D.page.evaluate(()=>{window.manualDuringBoot=Promise.all([refreshManufacturingHistory(true),refreshManufacturingHistory(true),refreshManufacturingHistory(true)]);startApplication();});
 assert.equal(await D.page.evaluate(()=>integrationStarts),1);release();await D.page.evaluate(()=>manualDuringBoot);
 assert.equal(await D.page.evaluate(()=>historyRenders.length),1);assert.equal(await D.page.evaluate(()=>integrationStarts),1);
 results.push('1-3,5: nonblocking one-shot startup; loading only; manual requests join startup; one final render');
 await D.page.unroute('https://supabase.test/rest/v1/manufacturing_records**');
 await D.page.route('https://supabase.test/rest/v1/manufacturing_records**',async route=>{await new Promise(resolve=>setTimeout(resolve,200));return mock(route);});
 const warmMark=requestLog.length;const begin=Date.now();await D.page.evaluate(()=>showManufacturingRecordHistory());
 const warmMs=Date.now()-begin;assert.equal(requestLog.length,warmMark,'warm history has zero cloud requests');
 assert.ok(warmMs<400,'no two 200ms cloud waits');
 const repeatMark=requestLog.length;await D.page.evaluate(async()=>{showHome();showManufacturingRecordTop();await showManufacturingRecordHistory();});assert.equal(requestLog.length,repeatMark);
 results.push('4,18: warm/reopened history reads only device data');
 console.log('HISTORY TIMING '+JSON.stringify({baseline:{warmHistoryMs:426,warmRecordGETs:2,delayPerRecordGETMs:200},current:{warmHistoryMs:warmMs,warmCloudRequests:requestLog.length-warmMark}}));
 await D.page.unroute('https://supabase.test/rest/v1/manufacturing_records**');
 let manualRelease;const manualGate=new Promise(resolve=>{manualRelease=resolve;});
 await D.page.route('https://supabase.test/rest/v1/manufacturing_records**',async route=>{await manualGate;return mock(route);});
 const previous=await D.page.evaluate(()=>({starts:integrationStarts,renders:historyRenders.length}));
 await D.page.evaluate(()=>{const b=document.getElementById('recordHistoryRefresh');b.dispatchEvent(new MouseEvent('click'));b.dispatchEvent(new MouseEvent('click'));b.dispatchEvent(new MouseEvent('click'));});
 await D.page.waitForFunction(n=>integrationStarts===n+1,previous.starts);manualRelease();await D.page.waitForFunction(n=>historyRenders.length===n+1,previous.renders);
 assert.equal(await D.page.evaluate(()=>integrationStarts),previous.starts+1);
 results.push('6: actual refresh-button repeated dispatch starts one integration and renders once');
 await D.page.unroute('https://supabase.test/rest/v1/manufacturing_records**');
 const successAt=await D.page.evaluate(()=>MeatProductionSync.getMeta('last_history_sync_at'));assert.ok(successAt);
 await D.page.route('https://supabase.test/**',route=>route.abort());
 await D.page.locator('#recordHistoryRefresh').click();await D.page.locator('#recordHistoryRefresh').waitFor();
 assert.match(await D.page.locator('#app').innerText(),/クラウド.*確認できていません/);
 assert.equal(await D.page.evaluate(()=>MeatProductionSync.getMeta('last_history_sync_at')),successAt);
 assert.equal(await D.page.evaluate(()=>MeatProductionSync.getMeta('last_history_sync_result')),'error');
 assert.ok(await D.page.locator('#recordHistorySyncTime').innerText());
 await D.page.unroute('https://supabase.test/**');
 await D.page.evaluate(async()=>{
   const fetch=window.fetch,timeout=window.setTimeout;
   window.setTimeout=(fn,ms,...args)=>timeout(fn,ms===15000?30:ms,...args);
   window.fetch=(url,options={})=>String(url).includes('/manufacturing_records?')?new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('hung mock GET','AbortError')),{once:true})):fetch(url,options);
   try {await refreshManufacturingHistory(true);}finally{window.fetch=fetch;window.setTimeout=timeout;}
 });
 assert.match(await D.page.locator('#app').innerText(),/クラウド.*確認できていません/);assert.equal(await D.page.evaluate(()=>MeatProductionSync.getMeta('last_history_sync_at')),successAt);
 results.push('9,17: network failure/deadline leave device list and previous successful time; failure metadata distinct');
 let navRelease;const navGate=new Promise(resolve=>{navRelease=resolve;});await D.page.route('https://supabase.test/rest/v1/manufacturing_records**',async route=>{await navGate;return mock(route);});
 const nav=await D.page.evaluate(()=>{window.navPending=refreshManufacturingHistory(true);showHome();return {html:app.innerHTML,renders:historyRenders.length};});navRelease();await D.page.evaluate(()=>navPending);
 assert.equal(await D.page.evaluate(()=>app.innerHTML),nav.html);assert.equal(await D.page.evaluate(()=>historyRenders.length),nav.renders);
 await D.page.unroute('https://supabase.test/rest/v1/manufacturing_records**');results.push('7: leaving during manual refresh preserves destination');
 const E=await device();const local={...base,id:id(),recipeCode:'ARABIKI',recipeId:'own:arabiki'};
 await E.page.evaluate(r=>{localStorage.setItem('manufacturingRecords',JSON.stringify([r]));window.renders=0;const render=renderManufacturingRecordHistory;renderManufacturingRecordHistory=(...args)=>{renders++;return render(...args);};testOnline=true;},local);
 let detailRelease;const detailGate=new Promise(resolve=>{detailRelease=resolve;});await E.page.route('https://supabase.test/rest/v1/manufacturing_records**',async route=>{await detailGate;return mock(route);});
 const detail=await E.page.evaluate(id=>{startApplication();showManufacturingRecordDetail(id);return app.innerHTML;},local.id);detailRelease();await E.page.evaluate(()=>startupManufacturingSync);
 assert.equal(await E.page.evaluate(()=>app.innerHTML),detail);assert.equal(await E.page.evaluate(()=>renders),0);
 await E.page.unroute('https://supabase.test/rest/v1/manufacturing_records**');results.push('8: startup completion never rewrites open detail');
 const F=await device(true);await F.page.evaluate(r=>{localStorage.setItem('manufacturingRecords',JSON.stringify([r]));testOnline=true;},local);
 let failedAttempts=0;await F.page.route('https://supabase.test/**',route=>{failedAttempts++;return route.abort();});const failureMark=requestLog.length;
 await F.page.evaluate(()=>startApplication());await F.page.evaluate(()=>showManufacturingRecordHistory());
 assert.equal(await F.page.locator('[data-type="record-detail"]').count(),1);assert.match(await F.page.locator('#app').innerText(),/クラウド.*確認できていません/);
 const attemptsAfterFailure=failedAttempts;await F.page.evaluate(async()=>{showHome();await showManufacturingRecordHistory();});assert.equal(failedAttempts,attemptsAfterFailure,'failed startup has no new attempts');assert.equal(requestLog.length,failureMark,'no automatic retry after failed startup');results.push('9: failed startup remains readable and does not retry on navigation');
 const O=await device(true);await O.page.evaluate(r=>localStorage.setItem('manufacturingRecords',JSON.stringify([r])),local);
 const offlineMark=requestLog.length;await O.page.evaluate(()=>startApplication());await O.page.evaluate(()=>showManufacturingRecordHistory());
 assert.equal(await O.page.locator('[data-type="record-detail"]').count(),1);assert.equal(requestLog.length,offlineMark);assert.match(await O.page.locator('#app').innerText(),/オフライン/);
 results.push('10: offline boot displays saved history with no cloud traffic');
 // A real background integration completes while a finished list remains visible.
 await D.page.evaluate(()=>showManufacturingRecordHistory());
 // The last-sync label hydrates asynchronously from IndexedDB after list render.
 await D.page.waitForFunction(()=>document.querySelector('#recordHistorySyncTime')?.textContent.startsWith('最終同期：'));
 const listBefore=await D.page.evaluate(()=>({html:app.innerHTML,renders:historyRenders.length}));
 let backgroundRelease;const backgroundGate=new Promise(resolve=>{backgroundRelease=resolve;});
 await D.page.route('https://supabase.test/rest/v1/manufacturing_records**',async route=>{await backgroundGate;return mock(route);});
 await D.page.evaluate(()=>{window.backgroundIntegration=runCrossDeviceIntegration();});backgroundRelease();await D.page.evaluate(()=>backgroundIntegration);
 assert.equal(await D.page.evaluate(()=>app.innerHTML),listBefore.html);assert.equal(await D.page.evaluate(()=>historyRenders.length),listBefore.renders);
 await D.page.unroute('https://supabase.test/rest/v1/manufacturing_records**');results.push('D: actual background integration completion leaves displayed list untouched');
 await D.page.evaluate(()=>showManufacturingRecordHistory());const steadyMark=requestLog.length;const startsBefore=await D.page.evaluate(()=>integrationStarts);
 await D.page.waitForFunction(()=>document.querySelector('#recordHistorySyncTime')?.textContent.startsWith('最終同期：'));
 const stableHtml=await D.page.locator('#app').innerHTML();await D.page.clock.install();await D.page.clock.fastForward(2*60*60*1000);
 await D.page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('pageshow'));startApplication();});
 assert.equal(await D.page.evaluate(()=>integrationStarts),startsBefore);assert.deepEqual(await D.page.evaluate(()=>intervalStarts),[]);assert.equal(requestLog.length,steadyMark);assert.equal(await D.page.locator('#app').innerHTML(),stableHtml);
 // Simulate an existing save/online cache completion event without permitting it to repaint history.
 await D.page.evaluate(()=>window.dispatchEvent(new CustomEvent('meat-production-history-cache',{detail:{success:true,updatedCount:99}})));
 assert.equal(await D.page.locator('#app').innerHTML(),stableHtml);results.push('15,16: two hours and foreground events start no periodic/duplicate sync; cache completion never repaints');
 for(const result of results)console.log('PASS startup/history '+result);
 assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
