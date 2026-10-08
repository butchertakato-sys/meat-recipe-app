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
   try {let body=fs.readFileSync(file);if(file.endsWith('index.html'))body=body.toString().replace('    initApp();','    // Controlled initialization in isolated integration tests.');return route.fulfill({body,contentType:file.endsWith('.js')?'application/javascript':'text/html'});}catch{ return route.abort(); }
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
 async function device(){const context=await browser.newContext({viewport:{width:820,height:1180}});await context.route('**/*',mock);await context.addInitScript(()=>{window.MEAT_SUPABASE_CONFIG={enabled:true,url:'https://supabase.test',publishableKey:'test-key',businessId:'business',accessToken:'test-token'};Object.defineProperty(navigator,'onLine',{get:()=>false});});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('http://app.test/');await page.evaluate(async()=>{await initializeManufacturingSync();await initializeSupabaseMasterData();MeatCrossDeviceSync.initialize(MEAT_SUPABASE_CONFIG);});return {context,page};}
 try {
 const a=await device(),page=a.page;
 const oldId=id();const herbId=id();
 await page.evaluate(async({base,oldId,herbId})=>{
  localStorage.setItem('meatRecipeApp.manufacturingRecords.v1',JSON.stringify([{...base},{...base,id:'old-herb',lot:'20261008-JI-HERB-01',recipeName:'ハーブ',packageCount:'',herbStandardPackageCount:0,herbEventPieceCount:161,herbStandardUnitWeightG:180,herbEventUnitWeightG:35}]));
  localStorage.setItem('manufacturingRecords',JSON.stringify([{...base,id:oldId,cloudRecordId:oldId,meatTotal:0,packageCount:0,syncStatus:'error'}]));
  await MeatProductionSync.putBundle({id:oldId,business_id:'business',lot_number:base.lot,product_id:null,recipe_id:null,recipe_version_id:null,legacy_payload:{packageCount:0,herbStandardPackageCount:0,herbEventPieceCount:0},status:'active'},[], 'error','master ID不足');
  await MeatProductionSync.putBundle({id:herbId,business_id:'business',lot_number:'20261008-JI-HERB-01',product_id:null,recipe_id:null,recipe_version_id:null,status:'active'},[], 'error','master ID不足');
  const history=combinedManufacturingHistory(await loadIndexedManufacturingHistory());
  const r=history.find(r=>r.lot===base.lot);if(Number(r.packageCount)!==25||r.meatTotal!==5000)throw Error('canonical display lost archive');
 },{base,oldId,herbId});
 await page.evaluate(()=>MeatProductionSync.syncPending());
 const restored=await page.evaluate(()=>MeatProductionSync.getLocalHistory());
 const ara=restored.find(b=>b.record.id===oldId),herb=restored.find(b=>b.record.id===herbId);
 assert.equal(ara.record.sync_status,'synced');assert.equal(ara.record.sync_error,null);assert.ok(ara.record.product_id&&ara.record.recipe_id&&ara.record.recipe_version_id);assert.equal(ara.allocations.find(a=>a.allocation_type==='STANDARD').quantity,25);assert.equal(herb.allocations.find(a=>a.allocation_type==='HERB_EVENT').quantity,161);
 assert.equal(await page.evaluate(()=>localStorage.getItem('meatRecipeApp.manufacturingRecords.v1')!==null),true);
 console.log('PASS TEST 1/3/5: real IndexedDB error bundle replaced, master IDs refreshed, archive quantities retained, sync error cleared, old v1 retained');
 const b=await device();await b.page.evaluate(()=>MeatProductionSync.pullHistoryFromCloud());
 const pulled=await b.page.evaluate(async()=>combinedManufacturingHistory(await loadIndexedManufacturingHistory()));
 assert.equal(Number(pulled.find(r=>r.lot===base.lot).packageCount),25);assert.equal(pulled.find(r=>r.lot===base.lot).meatTotal,5000);const pulledHerb=pulled.find(r=>r.lot==='20261008-JI-HERB-01');assert.equal(Number(pulledHerb.herbStandardPackageCount),0);assert.equal(Number(pulledHerb.herbEventPieceCount),161);
 console.log('PASS TEST 8/9: separate browser device pulls formal cloud columns + metadata, 25 packages and herb 0/161 survive');
 const saved={id:'new-saved',savedRecipeId:'new-saved',prepDate:'2026-10-09',category:'自社レシピ',recipeName:'チーズ',savedRecipeName:'チーズ',packagingKey:'cheese',meat6mm:5000,meat3mm:0,meatTotal:5000,totalWeight:6000,theoreticalFinishedWeight:6000,rows:[{name:'水',amount:1000}],total:1000};
 await page.evaluate(saved=>{localStorage.setItem('savedRecipes',JSON.stringify([saved]));showManufacturingRecordTop();},saved);
 await page.locator('[data-type="record-new"]').click();await page.locator('[data-type="record-from-saved"]').click();
 assert.equal(await page.locator('#screenTitle').innerText(),'製造数入力');assert.equal(await page.locator('#recordLot').isVisible(),false);assert.equal(await page.locator('#recordMemo').isVisible(),false);
 const saveBox=await page.locator('#recordSave').boundingBox(),moreBox=await page.locator('.record-other summary').boundingBox();assert.ok(saveBox.y<moreBox.y&&saveBox.height>=64);await page.locator('#recordPackageCount').fill('25');await page.locator('.record-other summary').click();await page.locator('#recordLeftoverWeight').fill('50');await page.locator('#recordMemo').fill('new fixture');await page.locator('.record-other summary').click();await page.locator('#recordSave').click();
 await page.waitForFunction(()=>loadManufacturingRecords().some(r=>r.memo==='new fixture'&&r.syncStatus==='synced'));
 const fresh=await page.evaluate(()=>loadManufacturingRecords().find(r=>r.memo==='new fixture'));assert.equal(Number(fresh.packageCount),25);assert.equal(Number(fresh.leftoverWeight),50);assert.ok(fresh.cloudRecordId&&fresh.lot);
 await b.page.evaluate(()=>MeatProductionSync.pullHistoryFromCloud());const newPulled=await b.page.evaluate(async()=>combinedManufacturingHistory(await loadIndexedManufacturingHistory()));const newRow=newPulled.find(r=>r.cloudRecordId===fresh.cloudRecordId);assert.equal(Number(newRow.packageCount),25);assert.equal(newRow.memo,'new fixture');assert.equal(Number(newRow.leftoverWeight),50);assert.equal(newRow.lot,fresh.lot);
 console.log('PASS TEST 7: unchanged manufacturing entry UI → localStorage → actual IndexedDB → mock cloud → separate device');
 await page.evaluate(saved=>{
   const herbSaved={...saved,id:'new-herb-saved',savedRecipeId:'new-herb-saved',recipeName:'ハーブ',savedRecipeName:'ハーブ',packagingKey:''};
   const existing=JSON.parse(localStorage.getItem('savedRecipes'));
   localStorage.setItem('savedRecipes',JSON.stringify([...existing,herbSaved]));
   showManufacturingRecordFromSavedRecipe('new-herb-saved');
 },saved);
 await page.locator('#recordHerbStandardPackageCount').fill('25');
 await page.locator('#recordHerbEventPieceCount').fill('161');
 await page.locator('.record-other summary').click();await page.locator('#recordMemo').fill('both herb counts');await page.locator('.record-other summary').click();await page.locator('#recordSave').click();
 await page.waitForFunction(()=>loadManufacturingRecords().some(r=>r.memo==='both herb counts'&&r.syncStatus==='synced'));
 await b.page.evaluate(()=>MeatProductionSync.pullHistoryFromCloud());
 const herbBoth=(await b.page.evaluate(async()=>combinedManufacturingHistory(await loadIndexedManufacturingHistory()))).find(r=>r.memo==='both herb counts');
 assert.equal(Number(herbBoth.herbStandardPackageCount),25);assert.equal(Number(herbBoth.herbEventPieceCount),161);
 console.log('PASS TEST 9: herb UI saves both 25 packages and 161 event pieces through IndexedDB/cloud/second-device pull');

 const sendsBefore=sends;await page.evaluate(()=>MeatProductionSync.syncPending());assert.equal(sends,sendsBefore);
 console.log('PASS TEST 6: already-synced complete bundles are not rewritten or resent');
 const migrationId=id();
 await page.evaluate(async({base,migrationId})=>{
   const archive=JSON.parse(localStorage.getItem('meatRecipeApp.manufacturingRecords.v1'));
   archive.push({...base,id:'old-chorizo',lot:'20261008-JI-CHORIZO-01',recipeName:'チョリソー',recipeCode:undefined});
   localStorage.setItem('meatRecipeApp.manufacturingRecords.v1',JSON.stringify(archive));
   await MeatProductionSync.putBundle({id:migrationId,business_id:'business',lot_number:'20261008-JI-CHORIZO-01',status:'active'},[], 'error','master ID不足');
   await runCrossDeviceIntegration();
 },{base,migrationId});
 const migrated=(await page.evaluate(()=>MeatProductionSync.getLocalHistory())).filter(b=>b.record.lot_number==='20261008-JI-CHORIZO-01');
 assert.equal(migrated.length,1);assert.equal(migrated[0].record.id,migrationId);assert.equal(migrated[0].record.sync_status,'synced');assert.equal(migrated[0].allocations.find(a=>a.allocation_type==='STANDARD').quantity,25);
 console.log('PASS TEST 2 migration: history refresh integration rebuilds old error bundle using same ID and unchanged LOT');

 // Direct REST fallback also has to retain quantities across pull.
 rpcMissing=true;const directRecord={...base,id:id(),cloudRecordId:id(),lot:'20261009-JI-CHORIZO-01',recipeName:'チョリソー',recipeCode:'CHORIZO'};
 await page.evaluate(async r=>{await saveManufacturingRecordOfflineFirst(r,{migration:true,preserveLot:true});},directRecord);
 await b.page.evaluate(()=>MeatProductionSync.pullHistoryFromCloud());const fallback=await b.page.evaluate(async()=>combinedManufacturingHistory(await loadIndexedManufacturingHistory()));assert.equal(Number(fallback.find(r=>r.lot==='20261009-JI-CHORIZO-01').packageCount),25);
 console.log('PASS RPC unavailable: direct REST fallback retains quantities and recovery metadata');
 // A conflict must not change LOT, send an overwrite, or remove any history.
 const conflictId=id();cloud.set(id(),{...cloud.get(oldId),id:id(),lot_number:'CONFLICT-LOT'});
 await page.evaluate(async({conflictId})=>{await MeatProductionSync.putBundle({id:conflictId,business_id:'business',lot_number:'CONFLICT-LOT',status:'active'},[],'error','master ID不足');},{conflictId});const conflictSends=sends;await page.evaluate(()=>MeatProductionSync.syncPending());assert.equal(sends,conflictSends);const conflict=(await page.evaluate(()=>MeatProductionSync.getLocalHistory())).find(b=>b.record.id===conflictId);assert.equal(conflict.record.lot_number,'CONFLICT-LOT');assert.match(conflict.record.sync_error,/LOT競合/);
 console.log('PASS LOT conflict is reported without renumbering, overwrite, or record deletion');
 // Regression for quantities which were already synchronized incorrectly.
 // Seed damaged cloud fixtures as synced, rather than starting with an error cache.
 rpcMissing=false;
 const c=await device();const d=await device();const zeroId=id();
 const specs=[
   {id:oldId,cloudRecordId:oldId,recipeName:'あらびき',lot:'20261008-JI-ARABIKI-01',packageCount:0,yieldRate:78,finishedWeight:4500},
   {id:migrationId,cloudRecordId:migrationId,recipeName:'チョリソー',lot:'20261008-JI-CHORIZO-01',packageCount:0,yieldRate:89.3,finishedWeight:4500},
   {id:herbId,cloudRecordId:herbId,recipeName:'ハーブ',lot:'20261008-JI-HERB-01',packageCount:'',herbStandardPackageCount:0,herbEventPieceCount:161,herbStandardUnitWeightG:180,herbEventUnitWeightG:35,yieldRate:99.4,finishedWeight:5635},
   {id:zeroId,cloudRecordId:zeroId,recipeName:'チーズ',lot:'20261008-JI-CHEESE-ZERO',packageCount:0,yieldRate:0,actualYieldPercent:0,finishedWeight:0,actualFinishedWeightG:0}
 ];
 const damaged=await c.page.evaluate(({base,specs})=>specs.map(s=>MeatProductionSyncAdapter.fromLegacy({...base,...s,updatedAt:'2026-10-12T00:00:00Z'},MEAT_SUPABASE_CONFIG,MeatProductionSync)),{base,specs});
 for(const bundle of damaged){
   const row={...bundle.record};delete row.legacy_payload;cloud.set(row.id,row);
   for(const [key,a]of allocations){
     if(a.manufacturing_record_id!==row.id)continue;
     const incoming=bundle.allocations.find(b=>b.allocation_type===a.allocation_type);
     allocations.set(key,incoming?{...incoming,id:key}:{...a,quantity:0,calculated_weight_g:0});
   }
   for(const incoming of bundle.allocations){
     if(![...allocations.values()].some(a=>a.manufacturing_record_id===row.id&&a.allocation_type===incoming.allocation_type))allocations.set(incoming.id,incoming);
   }
 }
 await c.page.evaluate(({base,specs})=>{
   localStorage.setItem('meatRecipeApp.manufacturingRecords.v1',JSON.stringify(specs.map(s=>({...base,...s,id:'archive-'+s.id,cloudRecordId:undefined,updatedAt:'2026-10-08T00:00:00Z',packageCount:s.recipeName==='ハーブ'?'':s.recipeName==='チョリソー'?31:25,herbStandardPackageCount:s.recipeName==='ハーブ'?25:undefined}))));
 },{base,specs});
 await c.page.evaluate(()=>MeatProductionSync.pullHistoryFromCloud());
 const before=(await c.page.evaluate(()=>MeatProductionSync.getLocalHistory())).find(b=>b.record.id===oldId);
 assert.equal(before.record.sync_status,'synced');assert.equal(before.record.sync_error,null);
 // Confirm the actual cached quantities are zero before the refresh trigger.
 assert.equal(Number((await c.page.evaluate(async id=>MeatHistoryRecovery.fromBundle((await MeatProductionSync.getLocalHistory()).find(b=>b.record.id===id)),oldId)).packageCount),0);
 await c.page.evaluate(()=>refreshManufacturingHistory(true));
 const localRecovered=await c.page.evaluate(async()=>combinedManufacturingHistory(await loadIndexedManufacturingHistory()));
 for(const s of specs.slice(0,2)){
   const local=localRecovered.find(r=>r.cloudRecordId===s.id);assert.equal(Number(local.packageCount),s.recipeName==='チョリソー'?31:25);assert.equal(local.syncStatus,'synced');assert.equal(local.syncError,'');assert.equal(local.lot,s.lot);
   assert.equal(allocations.size>0,true);const standard=[...allocations.values()].find(a=>a.manufacturing_record_id===s.id&&a.allocation_type==='STANDARD');assert.equal(standard.quantity,s.recipeName==='チョリソー'?31:25);
 }
 const herbStable=localRecovered.find(r=>r.cloudRecordId===herbId);assert.equal(Number(herbStable.herbStandardPackageCount),0);assert.equal(Number(herbStable.herbEventPieceCount),161);
 assert.equal(Number(localRecovered.find(r=>r.cloudRecordId===zeroId).packageCount),0);
 await d.page.evaluate(()=>MeatProductionSync.pullHistoryFromCloud());const remoteRecovered=await d.page.evaluate(async()=>combinedManufacturingHistory(await loadIndexedManufacturingHistory()));
 for(const s of specs.slice(0,2)){const r=remoteRecovered.find(r=>r.cloudRecordId===s.id);assert.equal(Number(r.packageCount),s.recipeName==='チョリソー'?31:25);assert.equal(r.syncStatus,'synced');assert.equal(r.syncError,'');assert.equal(r.lot,s.lot);}
 const herbRemote=remoteRecovered.find(r=>r.cloudRecordId===herbId);assert.equal(Number(herbRemote.herbStandardPackageCount),0);assert.equal(Number(herbRemote.herbEventPieceCount),161);assert.equal(Number(remoteRecovered.find(r=>r.cloudRecordId===zeroId).packageCount),0);
 assert.ok(await c.page.evaluate(()=>localStorage.getItem('meatRecipeApp.manufacturingRecords.v1')));
 console.log('PASS synced-zero regression: ARABIKI/CHORIZO 0 → archive 25/31 on device A, mock Supabase, device B; herb 0/161 and genuine zero protected; no sync errors');

 // Single-click raw diagnostics: v1-only, allocation-only, and herb cases.
 const e=await device();const f=await device();
 async function seedDiagnosticFixtures(page, fixtureSpecs){
   const bundles=await page.evaluate(({base,specs})=>specs.map(s=>MeatProductionSyncAdapter.fromLegacy({...base,...s,updatedAt:'2026-10-13T00:00:00Z'},MEAT_SUPABASE_CONFIG,MeatProductionSync)),{base,specs:fixtureSpecs});
   for(const bundle of bundles){
     const row={...bundle.record};delete row.legacy_payload;cloud.set(row.id,row);
     for(const [key,a]of allocations){if(a.manufacturing_record_id!==row.id)continue;const incoming=bundle.allocations.find(b=>b.allocation_type===a.allocation_type);allocations.set(key,incoming?{...incoming,id:key}:{...a,quantity:0,calculated_weight_g:0});}
     for(const incoming of bundle.allocations)if(![...allocations.values()].some(a=>a.manufacturing_record_id===row.id&&a.allocation_type===incoming.allocation_type))allocations.set(incoming.id,incoming);
   }
 }
 const diagnosticSpecs=specs.slice(0,3).map(s=>({...s,packageCount:s.recipeName==='ハーブ'?'':0}));
 await seedDiagnosticFixtures(e.page,diagnosticSpecs);
 // Only an allocation stores ARABIKI=25; all record snapshots remain zero.
 let araAllocation=[...allocations.values()].find(a=>a.manufacturing_record_id===oldId&&a.allocation_type==='STANDARD');
 if(!araAllocation){araAllocation={id:id(),manufacturing_record_id:oldId,business_id:'business',allocation_type:'STANDARD',quantity_unit:'package',unit_weight_g:180};}
 allocations.set(araAllocation.id,{...araAllocation,quantity:25,calculated_weight_g:4500});
 await e.page.evaluate(({base,specs})=>{
   localStorage.setItem('meatRecipeApp.manufacturingRecords.v1',JSON.stringify([{...base,id:'v1-only-chorizo',recipeName:'チョリソー',lot:'20261008-JI-CHORIZO-01',packageCount:31}]));
   localStorage.setItem('manufacturingRecords',JSON.stringify(specs.map(s=>({...base,...s}))));
   Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copiedDiagnostic=text;}}});
   window.diagnosticDeletes=[];
   const nativeDelete=IDBObjectStore.prototype.delete;
   IDBObjectStore.prototype.delete=function(key){window.diagnosticDeletes.push({store:this.name,key});return nativeDelete.call(this,key);};
   renderManufacturingRecordHistory([]);
 },{base,specs:diagnosticSpecs});
 const oldArchive=await e.page.evaluate(()=>localStorage.getItem('meatRecipeApp.manufacturingRecords.v1'));
 const logStart=requestLog.length;
 await e.page.locator('#pastManufacturingDiagnostics').click();await e.page.locator('#pastDiagnosticText').waitFor();
 const diagnosticText=await e.page.locator('#pastDiagnosticText').inputValue();assert.deepEqual(await e.page.evaluate(()=>window.diagnosticDeletes),[]);
 assert.match(diagnosticText,/packageCount: 31/);assert.match(diagnosticText,/packageCount: 0/);assert.match(diagnosticText,/復旧済み/);assert.match(diagnosticText,/localStorage meatRecipeApp.manufacturingRecords.v1/);
 for(const lot of ['20261008-JI-ARABIKI-01','20261008-JI-CHORIZO-01','20261008-JI-HERB-01'])assert.ok(diagnosticText.includes(lot));
 await e.page.locator('#pastDiagnosticCopy').click();assert.equal(await e.page.evaluate(()=>window.copiedDiagnostic),diagnosticText);
 assert.equal(await e.page.evaluate(()=>localStorage.getItem('meatRecipeApp.manufacturingRecords.v1')),oldArchive);
 assert.ok(requestLog.slice(logStart).filter(r=>r.method!=='GET').every(r=>r.method==='POST'&&r.table!=='save_manufacturing_record'));
 await f.page.evaluate(()=>MeatProductionSync.pullHistoryFromCloud());const diagnosedRemote=await f.page.evaluate(async()=>combinedManufacturingHistory(await loadIndexedManufacturingHistory()));
 assert.equal(Number(diagnosedRemote.find(r=>r.cloudRecordId===migrationId).packageCount),31);assert.equal(Number(diagnosedRemote.find(r=>r.cloudRecordId===oldId).packageCount),25);
 const diagHerb=diagnosedRemote.find(r=>r.cloudRecordId===herbId);assert.equal(Number(diagHerb.herbStandardPackageCount),0);assert.equal(Number(diagHerb.herbEventPieceCount),161);
 console.log('PASS diagnostic TEST 1/2/5: one button snapshots sources, restores v1-only 31 and allocation-only 25 with POST upserts only, preserves herb 0/161 and v1, copies full report, second-device verification');
 // No explicit quantities: expose inverse as candidate, never POST that record.
 const g=await device();await seedDiagnosticFixtures(g.page,diagnosticSpecs);
 await g.page.evaluate(({base,oldId})=>{
   localStorage.setItem('meatRecipeApp.manufacturingRecords.v1',JSON.stringify([{...base,id:'null-ara',packageCount:null}]));
   localStorage.setItem('manufacturingRecords',JSON.stringify([{...base,id:oldId,cloudRecordId:oldId,packageCount:''}]));
 },{base,oldId});
 const noDataLog=requestLog.length;const noData=await g.page.evaluate(()=>runPastManufacturingDiagnostics());const missing=noData.reports.find(r=>r.lot==='20261008-JI-ARABIKI-01');
 assert.equal(missing.decision,'元製造数データなし');assert.equal(missing.inference.count,25);assert.equal(missing.canRecover,false);assert.match(noData.text,/packageCount: null/);assert.match(noData.text,/packageCount: ""/);assert.match(noData.text,/packageCount: 0/);
 assert.ok(!requestLog.slice(noDataLog).some(r=>r.method==='POST'&&(r.table==='manufacturing_records'&&r.body.id===oldId||r.table==='manufacturing_allocations'&&r.body.some(a=>a.manufacturing_record_id===oldId))));
 console.log('PASS diagnostic TEST 3/4: all-zero/null/empty → source data absent; inverse 25 is candidate only, no writes for this LOT');
 const backgroundLog=requestLog.length;await g.page.evaluate(()=>refreshManufacturingHistory());
 assert.ok(!requestLog.slice(backgroundLog).some(r=>r.method==='POST'&&(r.table==='manufacturing_records'&&r.body.id===oldId||r.table==='manufacturing_allocations'&&r.body.some(a=>a.manufacturing_record_id===oldId))));
 console.log('PASS diagnostic inverse candidate remains unconfirmed after ordinary background history refresh');

 // Distinct positive counts in old and current storage: show conflict, no overwrite.
 const h=await device();await h.page.evaluate(base=>{
   localStorage.setItem('meatRecipeApp.manufacturingRecords.v1',JSON.stringify([{...base,lot:'20261008-JI-CHORIZO-01',recipeName:'チョリソー',packageCount:31}]));
   localStorage.setItem('manufacturingRecords',JSON.stringify([{...base,lot:'20261008-JI-CHORIZO-01',recipeName:'チョリソー',packageCount:35}]));
 },base);
 const conflictLog=requestLog.length;const diagnosisConflict=await h.page.evaluate(()=>runPastManufacturingDiagnostics());const conflicting=diagnosisConflict.reports.find(r=>r.lot==='20261008-JI-CHORIZO-01');assert.match(conflicting.decision,/競合/);assert.equal(conflicting.canRecover,false);
 assert.ok(!requestLog.slice(conflictLog).some(r=>r.method==='POST'&&(r.table==='manufacturing_records'&&r.body.id===migrationId||r.table==='manufacturing_allocations'&&r.body.some(a=>a.manufacturing_record_id===migrationId))));
 console.log('PASS diagnostic TEST 6: conflicting positives → conflict report, no writes for this LOT');
 await g.page.route('https://supabase.test/rest/v1/manufacturing_records**',r=>json(r,{message:'offline fixture'},503));
 const incomplete=await g.page.evaluate(()=>runPastManufacturingDiagnostics());assert.ok(incomplete.reports.every(r=>r.decision.includes('診断未完了')&&!r.canRecover));
 console.log('PASS diagnostic cloud unavailable: incomplete report, never falsely claims data absent');
 assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);console.log('PASS all integration assertions; no uncaught browser errors; no production requests');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
