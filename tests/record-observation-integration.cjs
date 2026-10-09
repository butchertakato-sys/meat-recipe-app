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
    tables.packaging_versions.push({id:id(),packaging_master_id:packaging,is_current:true,version_no:1,unit_weight_g:packageCode==='HERB_EVENT'?35:code==='GIBIER_CENTER'?65:180,package_weight_g:180,units_per_package:4,unit_type:packageCode==='HERB_EVENT'||code==='GIBIER_CENTER'?'piece':'package'});
  }
}
for(let i=0;i<52;i++)tables.recipe_ingredients.push({id:id(),recipe_version_id:tables.recipe_versions[0].id});
const cloud = new Map();const allocations = new Map();let rpcMissing=false;let sends=0;let failSend=false;let expireReservation=false;const unexpected=[];const requestLog=[];
function json(route,body,status=200){return route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});}
async function mock(route){
 const req=route.request(),url=new URL(req.url()),table=url.pathname.split('/').pop(),method=req.method();
 if(url.hostname==='app.test') {
   let file=path.join(root,url.pathname==='/'?'index.html':url.pathname);
   try {
     let body=fs.readFileSync(file);
     if(file.endsWith('index.html'))body=body.toString().replace('    initApp();','    // Controlled initialization in isolated integration tests.');
     return route.fulfill({body,contentType:file.endsWith('.js')?'application/javascript':'text/html'});
   } catch { return route.abort(); }
 }
 if(url.hostname!=='supabase.test') {if(url.hostname!=='cdn.jsdelivr.net')unexpected.push(req.url());return route.abort();}
 requestLog.push({table,method,body:method==='GET'?null:req.postDataJSON()});
 if(table==='save_manufacturing_record'){
   if(failSend)return json(route,{message:'mock send failure'},503);
   if(rpcMissing)return json(route,{code:'PGRST202',message:'save_manufacturing_record missing'},404);
   const {record_data:r,allocation_data:a}=req.postDataJSON();assert.ok(r.product_id&&r.recipe_id&&r.recipe_version_id);assert.equal(r.business_id,'business');
   const clean={...r};delete clean.legacy_payload;cloud.set(r.id,clean);for(const [key,row] of allocations)if(row.manufacturing_record_id===r.id)allocations.delete(key);for(const row of a)allocations.set(row.id,row);sends++;return json(route,{id:r.id});
 }
 if(table==='reserve_manufacturing_lot') {const b=req.postDataJSON();const suffix=Math.max(0,...[...cloud.values()].filter(r=>r.lot_number.startsWith(b.target_lot_base+'-')).map(r=>Number(r.lot_number.split('-').at(-1))||0))+1;return json(route,expireReservation?b.target_lot_base+'-99':(cloud.get(b.target_record_id)||{}).lot_number||b.target_lot_base+'-'+String(suffix).padStart(2,'0'));}
 if(table==='manufacturing_lot_reservations')return json(route,{message:'denied'},403);
 if(tables[table])return json(route,tables[table].slice(Number(url.searchParams.get('offset')||0),Number(url.searchParams.get('offset')||0)+Number(url.searchParams.get('limit')||10000)));
 if(table==='saved_recipe_calculations')return json(route,method==='POST'?[req.postDataJSON()]:[]);
 if(table==='manufacturing_records'){
  if(method==='POST'){const r=req.postDataJSON();assert.ok(r.product_id&&r.recipe_id&&r.recipe_version_id);cloud.set(r.id,r);sends++;return json(route,null,201);}
  const lotFilter=url.searchParams.get('lot_number');
  const lots=lotFilter?JSON.parse('['+lotFilter.slice(4,-1)+']'):null;
  return json(route,[...cloud.values()].filter(r=>!lots||lots.includes(r.lot_number)).slice(Number(url.searchParams.get('offset')||0),Number(url.searchParams.get('offset')||0)+Number(url.searchParams.get('limit')||10000)).map(r=>({...r,manufacturing_allocations:[...allocations.values()].filter(a=>a.manufacturing_record_id===r.id)})));
 }
 if(table==='manufacturing_allocations'){
  if(method==='POST'){for(const r of req.postDataJSON())allocations.set(r.id,r);return json(route,null,201);}
  if(method==='PATCH'){const key=url.searchParams.get('id').slice(3);allocations.set(key,{...allocations.get(key),...req.postDataJSON()});return json(route,null,200);}
  const recordId=(url.searchParams.get('manufacturing_record_id')||'').slice(3);return json(route,[...allocations.values()].filter(a=>!recordId||a.manufacturing_record_id===recordId).slice(Number(url.searchParams.get('offset')||0),Number(url.searchParams.get('offset')||0)+Number(url.searchParams.get('limit')||10000)));
 }
 unexpected.push(req.url());return json(route,{message:'unexpected request'},500);
}
const base={id:'old-record',lot:'20261008-JI-ARABIKI-01',recipeName:'あらびき',category:'自社レシピ',prepDate:'2026-10-08',date:'2026-10-08',meatTotal:5000,meat6mm:5000,meat3mm:0,totalWeight:6000,theoreticalFinishedWeight:6000,packageCount:25,packagingUnit:'パック',savedUnitWeightG:180,yieldRate:78,finishedWeight:4500,lossCount:0,memo:'archive memo'};
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});const errors=[];
 async function device(raw=false){const context=await browser.newContext({viewport:{width:820,height:1180}});await context.route('**/*',mock);await context.addInitScript(()=>{window.MEAT_SUPABASE_CONFIG={enabled:true,url:'https://supabase.test',publishableKey:'test-key',businessId:'business',accessToken:'test-token'};window.testOnline=false;Object.defineProperty(navigator,'onLine',{get:()=>window.testOnline});});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('http://app.test/');if(!raw)await page.evaluate(async()=>{await initializeManufacturingSync();await initializeSupabaseMasterData();MeatCrossDeviceSync.initialize(MEAT_SUPABASE_CONFIG);});return {context,page};}
 try {
 const lotA='20260728-IT-GIBIER-01',lotB='20260728-IT-GIBIER-02';
 const make=(lot,weight,recordId=id())=>({...base,id:recordId,manufacturingRecordId:recordId,cloudRecordId:recordId,lot,status:'active',
   recipeId:'client:gibier',recipeCode:'GIBIER_CENTER',recipeName:'ジビエセンター',category:'委託製造',prepDate:'2026-07-28',date:'2026-07-28',
   packagingUnit:'本',packageCount:'',smokedCount:82,unsmokedCount:80,completedCount:162,savedUnitWeightG:weight,unitWeight:weight,packWeight:weight,
   finishedWeight:162*weight,actualFinishedWeightG:162*weight,theoreticalFinishedWeight:12300,yieldRate:162*weight/12300*100,actualYieldPercent:162*weight/12300*100,
   savedRecipeId:'saved-recipe-fixture',createdAt:'2026-07-28T00:00:00Z',updatedAt:'2026-07-28T00:00:00Z',savedAt:'2026-07-28T00:00:00Z'});
 async function seed(dev,records,archive=[]){
   await dev.page.evaluate(async({records,archive})=>{
     localStorage.setItem('manufacturingRecords',JSON.stringify(records));
     localStorage.setItem('meatRecipeApp.manufacturingRecords.v1',JSON.stringify(archive));
     for(const r of records){const b=MeatProductionSyncAdapter.fromLegacy(r,MEAT_SUPABASE_CONFIG,MeatProductionSync);await MeatProductionSync.saveAndSync(b.record,b.allocations,{refreshHistory:false});}
   },{records,archive});
 }
 async function history(dev){return dev.page.evaluate(async()=>combinedManufacturingHistory(await loadIndexedManufacturingHistory()));}
 async function captureDelete(dev,record){
   dev.page.on('dialog',dialog=>dialog.accept());
   await dev.page.evaluate(r=>{showManufacturingRecordDetail(r.id);window.capturedDeleteMessage='';window.originalHistory=showManufacturingRecordHistory;showManufacturingRecordHistory=(_back,message)=>{capturedDeleteMessage=message;};},record);
   await dev.page.evaluate(id=>deleteManufacturingRecord(id),record.id);
   const message=await dev.page.evaluate(()=>capturedDeleteMessage||document.getElementById('recordDetailStatus')?.textContent);
   await dev.page.evaluate(()=>{showManufacturingRecordHistory=originalHistory;});return message;
 }
 const A=await device();const a=make(lotA,65);await seed(A,[a],[a]);
 const deleteMark=requestLog.length;
 assert.equal(await captureDelete(A,a),'削除しました');
 assert.equal(cloud.get(a.id).status,'deleted');
 assert.equal(cloud.get(a.id).lot_number,a.lot);
 assert.equal((await history(A)).length,0);
 await A.page.evaluate(()=>saveManufacturingRecords(loadManufacturingRecords()));
 assert.equal((await history(A)).length,0);
 assert.equal(await A.page.evaluate(()=>JSON.parse(localStorage.getItem('manufacturingRecords'))[0].status),'deleted');
 assert.equal(requestLog.slice(deleteMark).some(r=>r.table==='reserve_manufacturing_lot'),false);
 console.log('PASS deletion A: cloud success, original ID/LOT, tombstone survives unrelated local save');

 cloud.clear();allocations.clear();
 const B=await device();const b=make(lotB,70);await seed(B,[b],[{...b,recipeRows:[{name:'水',calculated:1000}]}]);failSend=true;
 assert.equal(await captureDelete(B,b),'端末では削除済みです。同期を待っています');
 assert.equal(cloud.get(b.id).status,'active');
 await B.page.evaluate(()=>MeatProductionSync.pullHistoryFromCloud());
 const pending=(await B.page.evaluate(()=>MeatProductionSync.getLocalRecords({includeDeleted:true}))).find(r=>r.id===b.id);
 assert.equal(pending.status,'deleted');assert.equal(pending.sync_status,'error');assert.equal((await history(B)).length,0);
 await B.page.evaluate(()=>showManufacturingAnalysis());
 assert.equal(await B.page.locator('[data-analysis-id]').count(),0,'analysis excludes local tombstone and old archive');
 failSend=false;const retryMark=requestLog.length;await B.page.evaluate(()=>runCrossDeviceIntegration());
 const retries=requestLog.slice(retryMark).filter(r=>r.table==='save_manufacturing_record');
 assert.ok(retries.some(r=>r.body.record_data.id===b.id&&r.body.record_data.status==='deleted'));
 assert.ok(retries.every(r=>r.body.record_data.id!==b.id||r.body.record_data.status==='deleted'));
 assert.equal(cloud.get(b.id).status,'deleted');assert.equal(cloud.get(b.id).lot_number,b.lot);
 assert.equal((await history(B)).length,0);
 console.log('PASS deletion B: pending result, archive stays hidden, analysis excludes deletion, retry uses same ID/LOT with no active upload');

 cloud.clear();allocations.clear();
 const C=await device();const c1=make('20260630-IT-GIBIER-01',65),c2=make(c1.lot,70);
 await seed(C,[c1,c2]);assert.equal(await captureDelete(C,c1),'削除しました');
 const separate=await history(C);assert.equal(separate.length,1);assert.equal(separate[0].id,c2.id);
 assert.equal(cloud.get(c1.id).status,'deleted');assert.equal(cloud.get(c2.id).status,'active');
 await C.page.evaluate(()=>saveManufacturingRecords(loadManufacturingRecords()));
 assert.equal((await history(C))[0].id,c2.id);
 console.log('PASS distinct same-LOT IDs: active and deleted records remain independent');

 cloud.clear();allocations.clear();
 const F=await device();const f=make('20260728-IT-GIBIER-LOCAL-FAIL',65);await seed(F,[f]);
 const beforeFail=await F.page.evaluate(async()=>({storage:localStorage.getItem('manufacturingRecords'),bundles:await MeatProductionSync.getLocalHistory()}));
 const failureMark=requestLog.length;
 await F.page.evaluate(()=>{window.originalPut=MeatProductionSync.putBundle;MeatProductionSync.putBundle=async()=>{throw Error('fixture IndexedDB quota failure');};window.originalSaveAndSync=MeatProductionSync.saveAndSync;MeatProductionSync.saveAndSync=async()=>{throw Error('fixture IndexedDB quota failure');};});
 assert.equal(await captureDelete(F,f),'削除できませんでした');
 await F.page.evaluate(()=>{MeatProductionSync.putBundle=originalPut;MeatProductionSync.saveAndSync=originalSaveAndSync;});
 assert.deepEqual(await F.page.evaluate(async()=>({storage:localStorage.getItem('manufacturingRecords'),bundles:await MeatProductionSync.getLocalHistory()})),beforeFail);
 assert.equal(cloud.get(f.id).status,'active');assert.equal(requestLog.slice(failureMark).some(r=>r.table==='save_manufacturing_record'),false);
 console.log('PASS deletion C: local persistence failure reports failure, all business stores unchanged');

 cloud.clear();allocations.clear();
 const D=await device();const d=make('20260728-IT-GIBIER-CLOUD-DEAD',65);await seed(D,[d],[d]);
 cloud.set(d.id,{...cloud.get(d.id),status:'deleted',updated_at:'2026-10-09T12:00:00Z'});
 const cloudDeadMark=requestLog.length;await D.page.evaluate(()=>runCrossDeviceIntegration());
 assert.equal((await history(D)).length,0);assert.equal(cloud.get(d.id).status,'deleted');
 assert.ok(requestLog.slice(cloudDeadMark).filter(r=>r.table==='save_manufacturing_record').every(r=>r.body.record_data.id!==d.id||r.body.record_data.status==='deleted'));
 // Stale cloud active cannot overwrite a committed local deletion, even with a later timestamp.
 cloud.set(d.id,{...cloud.get(d.id),status:'active',updated_at:'2099-01-01T00:00:00Z'});
 await D.page.evaluate(()=>MeatProductionSync.pullHistoryFromCloud());assert.equal((await history(D)).length,0);
 cloud.set(d.id,{...cloud.get(d.id),status:'deleted'});
 console.log('PASS remote deletion beats old active archive; stale active GET cannot overwrite cached tombstone');

 cloud.clear();allocations.clear();
 const P=await device();const pendingActive=make('20260728-IT-GIBIER-PENDING',65);await seed(P,[pendingActive],[pendingActive]);
 cloud.set(pendingActive.id,{...cloud.get(pendingActive.id),status:'deleted'});
 await P.page.evaluate(async record=>{const bundle=MeatProductionSyncAdapter.fromLegacy(record,MEAT_SUPABASE_CONFIG,MeatProductionSync);await MeatProductionSync.putBundle(bundle.record,bundle.allocations,'error','fixture pending active before cloud deletion');},pendingActive);
 const pendingDeadMark=requestLog.length;await P.page.evaluate(()=>runCrossDeviceIntegration());
 assert.equal(cloud.get(pendingActive.id).status,'deleted');assert.equal((await history(P)).length,0);
 assert.ok(requestLog.slice(pendingDeadMark).filter(r=>r.table==='save_manufacturing_record').every(r=>r.body.record_data.status==='deleted'));
 const blocked=await P.page.evaluate(async record=>{try{const bundle=MeatProductionSyncAdapter.fromLegacy(record,MEAT_SUPABASE_CONFIG,MeatProductionSync);await MeatProductionSync.putBundle(bundle.record,bundle.allocations);return false;}catch{return true;}},pendingActive);
 assert.equal(blocked,true,'stale local active cannot overwrite tombstone');
 console.log('PASS pending active versus remote deleted: retry sends deletion, local stale active write rejected');
 cloud.clear();allocations.clear();
 const U=await device();const legacyA={...make('20260728-IT-GIBIER-UNKNOWN',65),id:'unknown-A',manufacturingRecordId:'unknown-A',cloudRecordId:undefined},legacyB={...legacyA,id:'unknown-B',manufacturingRecordId:'unknown-B'};
 await U.page.evaluate(rows=>localStorage.setItem('manufacturingRecords',JSON.stringify(rows)),[legacyA,legacyB]);const unknownMark=requestLog.length;
 await U.page.evaluate(()=>runCrossDeviceIntegration());assert.equal(cloud.size,0);assert.equal((await history(U)).length,2);
 assert.equal(requestLog.slice(unknownMark).some(r=>['save_manufacturing_record','reserve_manufacturing_lot'].includes(r.table)),false);
 console.log('PASS unresolved legacy IDs: kept separate, no replacement UUID or cloud upload');

 cloud.clear();allocations.clear();
 const L=await device();const mismatch=make('20260728-IT-GIBIER-ORIGINAL',65);await seed(L,[mismatch]);
 cloud.set(mismatch.id,{...cloud.get(mismatch.id),lot_number:'20260728-IT-GIBIER-DIFFERENT'});
 await L.page.evaluate(async record=>{const bundle=MeatProductionSyncAdapter.fromLegacy(record,MEAT_SUPABASE_CONFIG,MeatProductionSync);await MeatProductionSync.putBundle(bundle.record,bundle.allocations,'error','fixture LOT mismatch');},mismatch);
 const mismatchMark=requestLog.length;await L.page.evaluate(()=>runCrossDeviceIntegration());
 assert.equal(requestLog.slice(mismatchMark).some(r=>r.table==='save_manufacturing_record'),false);
 assert.equal(cloud.get(mismatch.id).lot_number,'20260728-IT-GIBIER-DIFFERENT');
 const mismatchLocal=(await L.page.evaluate(()=>MeatProductionSync.getLocalRecords({includeDeleted:true}))).find(r=>r.id===mismatch.id);assert.equal(mismatchLocal.lot_number,mismatch.lot);assert.equal(mismatchLocal.sync_status,'error');
 console.log('PASS same-ID LOT mismatch is deferred without renaming either side or sending');

 cloud.clear();allocations.clear();
 const R=await device();const r=make('20260805-IT-GIBIER-01',70);await seed(R,[r]);expireReservation=true;
 const editMark=requestLog.length;
 await R.page.evaluate(record=>showManufacturingRecordDetail(record.id,true),r);
 await R.page.locator('.record-other summary').click();await R.page.fill('#editRecordMemo','snapshot edit fixture');await R.page.click('#recordEditSave');
 await R.page.waitForFunction(()=>loadManufacturingRecords().some(r=>r.memo==='snapshot edit fixture'));
 const edited=(await history(R)).find(row=>row.id===r.id);assert.equal(edited.lot,r.lot);assert.equal(edited.savedUnitWeightG,70);assert.equal(edited.finishedWeight,11340);
 assert.equal(await captureDelete(R,edited),'削除しました');expireReservation=false;
 assert.equal(cloud.get(r.id).lot_number,r.lot);assert.equal(cloud.get(r.id).status,'deleted');
 assert.equal(requestLog.slice(editMark).some(row=>row.table==='reserve_manufacturing_lot'),false);
 console.log('PASS edit/delete keep ID/LOT and historical 70g snapshot without reservation');

 // Actual history button, real IndexedDB/localStorage and delayed mock cloud GET.
 cloud.clear();allocations.clear();
 const H=await device();const h1=make('20260728-IT-GIBIER-02',65),h2=make('20260728-IT-GIBIER-01',70),h3={...make('20260805-IT-GIBIER-01',70),date:'2026-08-05',prepDate:'2026-08-05'},h4=make(h2.lot,65);
 await seed(H,[h1,h2,h3,h4]);
 const hd={...make('20260728-IT-GIBIER-DELETED',65),status:'deleted'};await seed(H,[h1,h2,h3,h4,hd],[hd]);
 await H.page.evaluate(()=>{window.testOnline=true;window.historyRenders=[];window.originalRender=renderManufacturingRecordHistory;renderManufacturingRecordHistory=(rows,...args)=>{historyRenders.push(rows.map(r=>r.id));return originalRender(rows,...args);};showManufacturingRecordTop();});
 await H.page.waitForFunction(()=>!crossDeviceIntegrationPromise);
 let release;const gate=new Promise(resolve=>{release=resolve;});let gets=0;
 await H.page.route('https://supabase.test/rest/v1/manufacturing_records**',async route=>{gets++;await gate;return mock(route);});
 const immediate=await H.page.evaluate(()=>{document.querySelector('[data-type="record-history"]').click();return {text:app.textContent.trim(),rows:app.querySelectorAll('[data-type="record-detail"]').length,renders:historyRenders.length};});
 assert.deepEqual(immediate,{text:'製造履歴を読み込み中...',rows:0,renders:0});
 await H.page.waitForTimeout(100);assert.equal(await H.page.evaluate(()=>historyRenders.length),0);assert.ok(gets>0);
 release();await H.page.waitForFunction(()=>historyRenders.length===1);
 const expected=[h3,h2,h4,h1].sort((a,b)=>b.date.localeCompare(a.date)||a.lot.localeCompare(b.lot)||a.id.localeCompare(b.id)).map(r=>r.id);
 assert.deepEqual(await H.page.evaluate(()=>historyRenders[0]),expected);
 await H.page.waitForTimeout(100);assert.equal(await H.page.evaluate(()=>historyRenders.length),1);
 await H.page.unroute('https://supabase.test/rest/v1/manufacturing_records**');
 const stable=await H.page.evaluate(async()=>{await showManufacturingRecordHistory();return historyRenders.at(-1);});assert.deepEqual(stable,expected);
 // Updating a record's timestamp must never change display order.
 await H.page.evaluate(async record=>{record.updatedAt='2099-01-01';await saveManufacturingRecordOfflineFirst(record);await showManufacturingRecordHistory();},h1);
 assert.deepEqual(await H.page.evaluate(()=>historyRenders.at(-1)),expected);
 console.log('PASS history: tap shows loading only, 0 interim renders, 1 final render, production-date/LOT/ID order stable despite updatedAt');

 await H.page.evaluate(()=>{testOnline=false;historyRenders=[];});
 const offlineMark=requestLog.length;await H.page.evaluate(()=>showManufacturingRecordHistory());
 assert.equal(await H.page.evaluate(()=>historyRenders.length),1);assert.deepEqual(await H.page.evaluate(()=>historyRenders[0]),expected);assert.equal(requestLog.length,offlineMark);
 await H.page.evaluate(()=>{testOnline=true;historyRenders=[];});
 await H.page.route('https://supabase.test/**',route=>route.abort());await H.page.evaluate(()=>showManufacturingRecordHistory());
 assert.equal(await H.page.evaluate(()=>historyRenders.length),1);assert.deepEqual(await H.page.evaluate(()=>historyRenders[0]),expected);await H.page.unroute('https://supabase.test/**');
 console.log('PASS history offline/network failure: exactly one local list, no stuck loading');

 // Exercise the existing AbortController transport deadlines, with only the
 // 15000ms timer shortened in this disposable test context (production unchanged).
 await H.page.evaluate(async()=>{
   const originalFetch=window.fetch,originalTimeout=window.setTimeout;
   window.setTimeout=(fn,ms,...args)=>originalTimeout(fn,ms===15000?50:ms,...args);
   window.fetch=(url,options={})=>String(url).includes('/manufacturing_records?')
     ? new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('fixture hung GET','AbortError')),{once:true}))
     : originalFetch(url,options);
   try {historyRenders=[];await showManufacturingRecordHistory();}
   finally {window.fetch=originalFetch;window.setTimeout=originalTimeout;}
 });
 assert.equal(await H.page.evaluate(()=>historyRenders.length),1);assert.deepEqual(await H.page.evaluate(()=>historyRenders[0]),expected);
 console.log('PASS existing request deadline: hung cloud GET aborts and renders one local list');

 let releaseStale;const staleGate=new Promise(resolve=>{releaseStale=resolve;});
 await H.page.route('https://supabase.test/rest/v1/manufacturing_records**',async route=>{await staleGate;return mock(route);});
 await H.page.evaluate(()=>{historyRenders=[];window.staleHistory=showManufacturingRecordHistory();showHome();});
 const home=await H.page.evaluate(()=>app.innerHTML);releaseStale();await H.page.evaluate(()=>staleHistory);
 assert.equal(await H.page.evaluate(()=>historyRenders.length),0);assert.equal(await H.page.evaluate(()=>app.innerHTML),home);await H.page.unroute('https://supabase.test/rest/v1/manufacturing_records**');
 await H.page.evaluate(()=>showManufacturingAnalysis());
 const analyzed=await H.page.locator('[data-analysis-id]').evaluateAll(nodes=>nodes.map(n=>n.dataset.analysisId));assert.ok(!analyzed.includes(hd.id));assert.equal(analyzed.length,expected.length);
 console.log('PASS navigation: stale async task cannot render after leaving; deleted rows excluded from list and analysis');

 // Fixture is generated by the production recipe calculation, not by a prefilled denominator.
 cloud.clear();allocations.clear();
 const N=await device();const nPast={...make('20260805-IT-GIBIER-SNAPSHOT',70),date:'2026-08-05'};await seed(N,[nPast]);
 const recipeFixture=await N.page.evaluate(()=>{
   const rows=calculateGibier(7000,3000);
   const saved=enrichSavedRecipeCalculation({id:'gibier-new-fixture',savedRecipeId:'gibier-new-fixture',prepDate:'2026-07-28',category:'委託製造',recipeName:'ジビエセンター鹿ソーセージ',savedRecipeName:'ジビエセンター鹿ソーセージ',recipeCode:'GIBIER',recipeKind:'gibier',meat6mm:7000,meat3mm:3000,meatTotal:10000,rows,total:sumRows(rows)});
   localStorage.setItem('savedRecipes',JSON.stringify([saved]));return saved;
 });
 assert.equal(recipeFixture.meatTotal,10000);assert.equal(recipeFixture.waterAmount,2000);assert.equal(recipeFixture.totalWeight,12300);assert.equal(recipeFixture.theoreticalFinishedWeight,12300);
 async function newForm(dev){await dev.page.evaluate(()=>showManufacturingRecordForm({recordCategory:'委託製造',recordRecipe:'client:gibier',recordSavedRecipeId:'gibier-new-fixture',recordPrepDate:'2026-07-28',recordDate:'2026-07-28',recordSmokedCount:'82',recordUnsmokedCount:'80'}));}
 await newForm(N);
 const saveStart=sends;const newMark=requestLog.length;
 // Synchronous double dispatch also tests the handler guard rather than only the disabled button.
 await N.page.evaluate(()=>{const button=document.getElementById('recordSave');button.dispatchEvent(new MouseEvent('click'));button.dispatchEvent(new MouseEvent('click'));document.getElementById('recordSmokedCount').dispatchEvent(new Event('input'));});
 await N.page.waitForFunction(()=>document.getElementById('recordSaveComplete').value==='true');
 assert.equal(sends-saveStart,1);
 const fresh=await N.page.evaluate(()=>loadManufacturingRecords().find(r=>r.savedRecipeId==='gibier-new-fixture'));
 assert.equal(fresh.completedCount,'162');assert.equal(fresh.savedUnitWeightG,65);assert.equal(fresh.finishedWeight,10530);assert.equal(fresh.theoreticalFinishedWeight,12300);assert.equal(fresh.actualYieldPercent,85.60975609756098);
 const cloudFresh=cloud.get(fresh.id);assert.equal(cloudFresh.completed_weight_g,10530);assert.equal(cloudFresh.theoretical_weight_g,12300);assert.equal(cloudFresh.yield_rate,85.60975609756098);
 const saveRequests=requestLog.slice(newMark);assert.equal(saveRequests.filter(r=>r.table==='reserve_manufacturing_lot').length,1);
 assert.ok(saveRequests.findIndex(r=>r.table==='packaging_versions')<saveRequests.findIndex(r=>r.table==='save_manufacturing_record'),'formal packaging master checked before new save');
 await N.page.evaluate(()=>document.getElementById('recordSave').dispatchEvent(new MouseEvent('click')));assert.equal(sends-saveStart,1);
 const oldSnapshot=(await history(N)).find(r=>r.id===nPast.id);assert.equal(oldSnapshot.savedUnitWeightG,70);assert.equal(oldSnapshot.finishedWeight,11340);
 console.log('PASS new 65g: recipe 7000+3000+2300=12300, 162×65=10530, yield=85.60975609756098; double save blocked; historical 70g intact');

 // Local failure after reservation: reload/restored draft must retain ID and LOT.
 await newForm(N);await N.page.evaluate(()=>{window.actualSave=MeatProductionSync.saveAndSync;MeatProductionSync.saveAndSync=async()=>{throw Error('fixture quota failure after reservation');};});
 const draftMark=requestLog.length;await N.page.click('#recordSave');await N.page.waitForFunction(()=>!document.getElementById('recordSave').disabled);
 const draft=await N.page.evaluate(()=>loadScreenState());assert.ok(draft.form.recordIdentity);assert.ok(draft.form.recordReservedLot);assert.notEqual(draft.form.recordIdentity,fresh.id);
 await N.page.reload();await N.page.evaluate(async()=>{await initializeManufacturingSync();await initializeSupabaseMasterData();MeatCrossDeviceSync.initialize(MEAT_SUPABASE_CONFIG);restoreScreenState(loadScreenState());});
 assert.equal(await N.page.inputValue('#recordIdentity'),draft.form.recordIdentity);
 await N.page.click('#recordSave');await N.page.waitForFunction(()=>document.getElementById('recordSaveComplete').value==='true');
 const second=(await history(N)).find(r=>r.id===draft.form.recordIdentity);assert.ok(second);assert.equal(second.lot,draft.form.recordReservedLot);assert.notEqual(second.id,fresh.id);assert.notEqual(second.lot,fresh.lot);
 assert.equal(requestLog.slice(draftMark).filter(r=>r.table==='reserve_manufacturing_lot').length,1,'retry does not reserve again');
 assert.equal((await history(N)).filter(r=>r.savedRecipeId==='gibier-new-fixture').length,2,'legitimate same-day manufacturing events retained');
 console.log('PASS restored draft after save failure keeps ID/LOT; retry no new reservation; same-day multiple manufacturing preserved');

 // Diagnostic stays GET-only, bounded to target day and leaves business stores unchanged.
 cloud.clear();allocations.clear();
 const O=await device();const o1=make(lotA,65),o2={...make(lotB,70),createdAt:'2026-07-28T00:01:30Z',savedAt:'2026-07-28T00:01:30Z'};await seed(O,[o1,o2],[o1]);
 await O.page.evaluate(()=>{
   localStorage.setItem('savedRecipes',JSON.stringify([{id:'saved-recipe-fixture',savedRecipeId:'saved-recipe-fixture',recipeName:'ジビエセンター',prepDate:'2026-07-28',sourceDeviceId:'fixture-device'}]));
   window.copiedObservation='';Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{copiedObservation=text;}}});
   window.forbiddenObservationCalls=[];
   for(const name of ['initializeManufacturingSync','initializeSupabaseMasterData','loadManufacturingRecords','loadSavedRecipeCalculations','loadPackagingMaster','runCrossDeviceIntegration'])window[name]=()=>{forbiddenObservationCalls.push(name);throw Error(name);};
 });
 const before=await O.page.evaluate(async()=>({storage:{...localStorage},bundles:await MeatProductionSync.getLocalHistory()}));const observationMark=requestLog.length;
 await O.page.evaluate(()=>MeatRecordObservation.show());await O.page.locator('#recordObservationCopy:enabled').waitFor();
 const report=JSON.parse(await O.page.locator('#recordObservation textarea').inputValue());
 assert.equal(report.localStorage.manufacturingRecords.targetRecords[0].fields.savedUnitWeightG.value,65);
 assert.equal(report.indexedDB.targetRecords.find(r=>r.raw.id===o2.id).allocations.find(a=>a.raw.allocation_type==='GIBIER_SMOKED').raw.unit_weight_g,70);
 assert.ok(report.supabase.tables.manufacturing_records.targetRecords.some(r=>r.raw.id===o2.id));
 assert.equal(report.supabase.tables.manufacturing_lot_reservations,undefined);assert.equal(report.supabase.tables.packaging_master,undefined);assert.equal(report.supabase.tables.packaging_versions,undefined);
 assert.equal(report.canonicalObservation.currentHistoryPathDeletedIndexedExcluded,undefined);assert.equal(report.localStorage.manufacturingRecords.raw,undefined);
 assert.equal(report.timelines.current[2].creationDifferences.find(r=>r.field==='createdAt').seconds,90);
 assert.equal(report.savedRecipes.savedRecipes.rows[0].sourceDeviceId,'fixture-device');assert.equal(report.consistency.indexedChangedDuringRead,false);assert.deepEqual(report.consistency.changedLocalStorageKeys,[]);
 await O.page.locator('#recordObservationCopy').click();assert.equal(await O.page.evaluate(()=>copiedObservation),await O.page.locator('#recordObservation textarea').inputValue());assert.deepEqual(await O.page.evaluate(()=>forbiddenObservationCalls),[]);
 assert.deepEqual(await O.page.evaluate(async()=>({storage:{...localStorage},bundles:await MeatProductionSync.getLocalHistory()})),before);
 assert.ok(requestLog.slice(observationMark).every(r=>r.method==='GET'&&['manufacturing_records','manufacturing_allocations','saved_recipe_calculations'].includes(r.table)));
 const missing=await device(true);const dbBefore=await missing.page.evaluate(()=>indexedDB.databases());await missing.page.evaluate(()=>MeatRecordObservation.show());await missing.page.locator('#recordObservationCopy:enabled').waitFor();assert.deepEqual(await missing.page.evaluate(()=>indexedDB.databases()),dbBefore);
 await O.page.setViewportSize({width:390,height:844});assert.equal(await O.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await O.page.evaluate(()=>{MEAT_SUPABASE_CONFIG.accessToken='';MEAT_SUPABASE_CONFIG.getAccessToken=()=>{throw Error('SDK auth refresh must not be called');};localStorage.setItem('sb-supabase-auth-token',JSON.stringify({access_token:'test-persisted-token',refresh_token:'test-refresh-secret'}));});
 const authStorage=await O.page.evaluate(()=>JSON.stringify({...localStorage}));const authReport=await O.page.evaluate(()=>MeatRecordObservation.collect());assert.equal(authReport.supabase.tables.manufacturing_records.state,'read');assert.equal(JSON.stringify(authReport).includes('test-persisted-token'),false);assert.equal(JSON.stringify(authReport).includes('test-refresh-secret'),false);assert.equal(await O.page.evaluate(()=>JSON.stringify({...localStorage})),authStorage);
 console.log('PASS read-only diagnosis: target identities/timestamps/snapshots, copy, GET only, no master/reservation reads, unchanged stores/auth, no absent DB creation');
 assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
