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
 if(table==='reserve_manufacturing_lot') {const b=req.postDataJSON();return json(route,expireReservation?b.target_lot_base+'-02':(cloud.get(b.target_record_id)||{}).lot_number||b.target_lot_base+'-01');}
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
 const A=await device();const a=make(lotA,65);await seed(A,[a]);
 await A.page.evaluate(async r=>{
   const deleted={...r,status:'deleted',updatedAt:'2026-10-09T12:00:00Z'};
   await saveManufacturingRecordOfflineFirst(deleted,{migration:true});
   localStorage.setItem('manufacturingRecords',JSON.stringify([deleted]));
   await MeatProductionSync.refreshHistoryCache();
 },a);
 assert.equal(cloud.get(a.id).status,'deleted');
 assert.equal((await A.page.evaluate(()=>MeatProductionSync.getLocalRecords({includeDeleted:true})))[0].status,'deleted');
 assert.equal((await A.page.evaluate(async()=>combinedManufacturingHistory(await loadIndexedManufacturingHistory()))).length,0);
 console.log('PASS CASE A: same-ID successful tombstone stays hidden after refresh');

 const B=await device();const b=make(lotB,70);await seed(B,[b]);failSend=true;
 const failure=await B.page.evaluate(async r=>{
   const deleted={...r,status:'deleted',updatedAt:'2026-10-09T12:00:00Z'};
   const result=await saveManufacturingRecordOfflineFirst(deleted,{migration:true});
   localStorage.setItem('manufacturingRecords',JSON.stringify([deleted]));
   await MeatProductionSync.pullHistoryFromCloud();
   return {synced:result.synced,rows:await MeatProductionSync.getLocalRecords({includeDeleted:true}),history:combinedManufacturingHistory(await loadIndexedManufacturingHistory())};
 },b);
 assert.equal(failure.synced,false);assert.equal(cloud.get(b.id).status,'active');
 assert.equal(failure.rows.find(r=>r.id===b.id).status,'deleted');assert.equal(failure.rows.find(r=>r.id===b.id).sync_status,'error');
 assert.equal(failure.history.length,0);
 // The actual delete UI ignores synced:false. Intercept only navigation to observe
 // its immediate message without starting the independent history refresh.
 B.page.on('dialog',dialog=>dialog.accept());
 await B.page.evaluate(r=>{localStorage.setItem('manufacturingRecords',JSON.stringify([r]));window.capturedDeleteMessage='';showManufacturingRecordHistory=(_back,message)=>{capturedDeleteMessage=message;};},b);
 await B.page.evaluate(id=>deleteManufacturingRecord(id),b.id);
 assert.equal(await B.page.evaluate(()=>capturedDeleteMessage),'削除しました');
 failSend=false;
 await B.page.evaluate(()=>MeatProductionSync.refreshHistoryCache());
 assert.equal(cloud.get(b.id).status,'deleted');
 console.log('PASS CASE B: failed delete retains error tombstone against active cloud; UI still says deleted; retry sends deleted');

 const C=await device();const c1=make('20260728-IT-GIBIER-C',65),c2=make('20260728-IT-GIBIER-C',70);await seed(C,[c1,c2]);
 await C.page.evaluate(async r=>{const deleted={...r,status:'deleted',updatedAt:'2026-10-09T12:00:00Z'};await saveManufacturingRecordOfflineFirst(deleted,{migration:true});localStorage.setItem('manufacturingRecords',JSON.stringify([deleted]));await MeatProductionSync.pullHistoryFromCloud();},c1);
 assert.equal(cloud.get(c1.id).status,'deleted');assert.equal(cloud.get(c2.id).status,'active');
 const remaining=await C.page.evaluate(async()=>combinedManufacturingHistory(await loadIndexedManufacturingHistory()));
 assert.equal(remaining.some(r=>r.lot==='20260728-IT-GIBIER-C'),false,'local tombstone can hide same-LOT other ID');
 const otherVisible=await C.page.evaluate(async()=>{saveManufacturingRecords(loadManufacturingRecords());return combinedManufacturingHistory(await loadIndexedManufacturingHistory());});
 assert.equal(otherVisible.find(r=>r.lot==='20260728-IT-GIBIER-C').status,'active');
 console.log('PASS CASE C: same-LOT other ID remains cloud active; tombstone initially hides it, later local save removes tombstone and exposes it');

 const D=await device();const d=make('20260728-IT-GIBIER-D',65);await seed(D,[d],[{...d,id:'legacy-D',cloudRecordId:undefined,manufacturingRecordId:'legacy-D'}]);
 cloud.set(d.id,{...cloud.get(d.id),status:'deleted',updated_at:'2026-10-09T12:00:00Z'});
 const merged=await D.page.evaluate(async r=>{
   const deleted={...r,status:'deleted',syncStatus:'error',updatedAt:'2026-10-09T12:00:00Z'};
   const bundle=MeatProductionSyncAdapter.fromLegacy(deleted,MEAT_SUPABASE_CONFIG,MeatProductionSync);
   await MeatProductionSync.putBundle(bundle.record,bundle.allocations,'synced');
   localStorage.setItem('manufacturingRecords',JSON.stringify([deleted]));
   const indexed=(await MeatProductionSync.getLocalHistory()).map(cachedBundleToManufacturingRecord);
   return {full:canonicalManufacturingHistory(indexed),filtered:combinedManufacturingHistory(await loadIndexedManufacturingHistory())};
 },d);
 assert.equal(merged.full[0].status,'deleted');
 console.log('PASS CASE D: canonical with IndexedDB tombstone beats old archive');
 assert.equal(merged.filtered[0].status,'active');
 // A healthy latest synced local tombstone is instead preserved by healthyRecord.
 const syncedE=await D.page.evaluate(async()=>{const rows=JSON.parse(localStorage.getItem('manufacturingRecords'));rows[0].syncStatus='synced';localStorage.setItem('manufacturingRecords',JSON.stringify(rows));return combinedManufacturingHistory(await loadIndexedManufacturingHistory());});
 assert.equal(syncedE.length,0);
 // An unrelated later save uses loadManufacturingRecords(), dropping tombstones.
 const goneE=await D.page.evaluate(async()=>{saveManufacturingRecords(loadManufacturingRecords());return combinedManufacturingHistory(await loadIndexedManufacturingHistory());});
 assert.equal(goneE[0].status,'active');
 await D.page.evaluate(()=>runCrossDeviceIntegration());
 assert.equal(cloud.get(d.id).status,'deleted','complete cloud tombstone prevents migration republishing active in this fixture');
 console.log('PASS CASE E: excluding IndexedDB deleted exposes archive with local error tombstone or removed local tombstone; available cloud tombstone prevents cloud revival');

 const F=await device();const f=make('20260728-IT-GIBIER-FAILED',65);await seed(F,[f],[{...f,id:'old-F',manufacturingRecordId:'old-F',cloudRecordId:undefined,recipeRows:[{name:'水',amount:1000}]}]);failSend=true;
 await F.page.evaluate(async r=>{const deleted={...r,status:'deleted',updatedAt:'2026-10-09T12:00:00Z'};await saveManufacturingRecordOfflineFirst(deleted,{migration:true});localStorage.setItem('manufacturingRecords',JSON.stringify([deleted]));},f);
 failSend=false;const recoveryMark=requestLog.length;await F.page.evaluate(()=>runCrossDeviceIntegration());
 assert.ok(requestLog.slice(recoveryMark).some(req=>req.table==='save_manufacturing_record'&&req.body.record_data.id===f.id&&req.body.record_data.status==='active'));
 assert.equal(cloud.get(f.id).status,'active');
 assert.equal((await F.page.evaluate(()=>MeatProductionSync.getLocalRecords({includeDeleted:true}))).find(r=>r.id===f.id).status,'active');
 console.log('PASS B + E: failed deletion plus active archive with complementary recipe rows becomes active through filtered canonical -> migration recovery -> active upload before pending retry');

 // Expired reservation follows the SQL max(active/reserved suffix)+1, even on
 // delete/edit. Observe legacy meta before reservation versus formal row after.
 const R=await device();const r=make('20260728-IT-GIBIER-RESERVE-01',65);await seed(R,[r],[{...r,id:'old-R',manufacturingRecordId:'old-R',cloudRecordId:undefined}]);expireReservation=true;
 const reserved=await R.page.evaluate(async r=>{const deleted={...r,status:'deleted',updatedAt:'2026-10-09T12:00:00Z'};const result=await saveManufacturingRecordOfflineFirst(deleted);localStorage.setItem('manufacturingRecords',JSON.stringify([deleted]));return {deleted,result};},r);
 expireReservation=false;
 assert.equal(reserved.deleted.lot,'20260728-IT-GIBIER-RESERVE-02');
 const reservationMeta=JSON.parse(reserved.result.allocations.find(a=>a.allocation_type==='LEGACY_META').notes);
 assert.equal(reservationMeta.lot,r.lot);
 await R.page.evaluate(()=>runCrossDeviceIntegration());
 const recreated=[...cloud.values()].find(row=>row.lot_number===r.lot&&row.status==='active');
 assert.ok(recreated);assert.notEqual(recreated.id,r.id);
 console.log('PASS extra path: expired reservation changes delete LOT; unlinked archive can migrate old LOT under new UUID');

 // UI uses direct GET/readonly transactions; preserve every business store and
 // localStorage byte. No app initializer, RPC or cache is called by diagnostics.
 const O=await device();const o1=make(lotA,65),o2={...make(lotB,70),createdAt:'2026-07-28T00:01:30Z',savedAt:'2026-07-28T00:01:30Z'};await seed(O,[o1,o2],[o1]);
 await O.page.evaluate(()=>showManufacturingRecordTop());
 await O.page.waitForFunction(()=>document.getElementById('manufacturingSyncStatus').textContent!=='未同期：確認中');
 await O.page.evaluate(()=>{
   localStorage.setItem('savedRecipes',JSON.stringify([{id:'saved-recipe-fixture',savedRecipeId:'saved-recipe-fixture',recipeName:'ジビエセンター',prepDate:'2026-07-28',sourceDeviceId:'fixture-device'}]));
   window.copiedObservation='';Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{copiedObservation=text;}}});
   window.forbiddenObservationCalls=[];
   for(const name of ['initializeManufacturingSync','initializeSupabaseMasterData','loadManufacturingRecords','loadSavedRecipeCalculations','loadPackagingMaster','runCrossDeviceIntegration'])window[name]=()=>{forbiddenObservationCalls.push(name);throw Error(name);};
 });
 const before=await O.page.evaluate(async()=>({storage:{...localStorage},bundles:await MeatProductionSync.getLocalHistory()}));
 const observationMark=requestLog.length;
 await O.page.locator('[data-type="record-observation"]').click();await O.page.locator('#recordObservationCopy:enabled').waitFor();
 // An independent existing history render must not remove diagnostic output.
 await O.page.evaluate(()=>renderManufacturingRecordHistory([]));
 const report=JSON.parse(await O.page.locator('#recordObservation textarea').inputValue());
 assert.equal(report.localStorage.manufacturingRecords.targetRecords[0].fields.savedUnitWeightG.value,65);
 assert.equal(report.indexedDB.targetRecords.find(r=>r.raw.id===o2.id).allocations.find(a=>a.raw.allocation_type==='GIBIER_SMOKED').raw.unit_weight_g,70);
 assert.ok(report.supabase.tables.manufacturing_records.targetRecords.some(r=>r.raw.id===o2.id));
 assert.ok(report.supabase.tables.manufacturing_allocations.rows.some(a=>a.manufacturing_record_id===o1.id));
 assert.equal(report.supabase.tables.manufacturing_lot_reservations.error,'HTTP 403');
 assert.equal(report.timelines.current[2].creationDifferences.find(r=>r.field==='createdAt').seconds,90);
 assert.equal(report.savedRecipes.savedRecipes.rows[0].sourceDeviceId,'fixture-device');
 assert.equal(report.consistency.indexedChangedDuringRead,false);assert.deepEqual(report.consistency.changedLocalStorageKeys,[]);
 await O.page.locator('#recordObservationCopy').click();
 assert.equal(await O.page.evaluate(()=>copiedObservation),await O.page.locator('#recordObservation textarea').inputValue());
 assert.deepEqual(await O.page.evaluate(()=>forbiddenObservationCalls),[]);
 const after=await O.page.evaluate(async()=>({storage:{...localStorage},bundles:await MeatProductionSync.getLocalHistory()}));
 assert.deepEqual(after,before);assert.ok(requestLog.slice(observationMark).every(r=>r.method==='GET'));
 const N=await device(true);const dbBefore=await N.page.evaluate(()=>indexedDB.databases());
 await N.page.evaluate(()=>MeatRecordObservation.show());await N.page.locator('#recordObservationCopy:enabled').waitFor();
 assert.deepEqual(await N.page.evaluate(()=>indexedDB.databases()),dbBefore,'absent DB is never created');
 const types=await N.page.evaluate(()=>MeatRecordObservation.fields({nil:null,undef:undefined,empty:'',zero:0,positive:65},['missing','nil','undef','empty','zero','positive']));
 assert.deepEqual(Object.values(types).map(v=>v.type),['missing','null','undefined','empty-string','number','number']);
 await O.page.setViewportSize({width:390,height:844});assert.equal(await O.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 // Read the persisted default auth session without invoking the SDK refresh path.
 await O.page.evaluate(()=>{MEAT_SUPABASE_CONFIG.accessToken='';MEAT_SUPABASE_CONFIG.getAccessToken=()=>{throw Error('SDK auth refresh must not be called');};localStorage.setItem('sb-supabase-auth-token',JSON.stringify({access_token:'test-persisted-token',refresh_token:'test-refresh-secret'}));});
 const authStorage=await O.page.evaluate(()=>JSON.stringify({...localStorage}));
 const authReport=await O.page.evaluate(()=>MeatRecordObservation.collect());
 assert.equal(authReport.supabase.tables.manufacturing_records.state,'read');
 assert.equal(JSON.stringify(authReport).includes('test-persisted-token'),false);assert.equal(JSON.stringify(authReport).includes('test-refresh-secret'),false);
 assert.equal(await O.page.evaluate(()=>JSON.stringify({...localStorage})),authStorage);
 console.log('PASS observation: target layers, raw/meta weights, timeline, copy, GET only, unchanged stores, missing DB, typed values, mobile');
 assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
