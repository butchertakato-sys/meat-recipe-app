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
const cloud = new Map();const allocations = new Map();let rpcMissing=false;let sends=0;const unexpected=[];
function json(route,body,status=200){return route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});}
async function mock(route){
 const req=route.request(),url=new URL(req.url()),table=url.pathname.split('/').pop(),method=req.method();
 if(url.hostname==='app.test') {
   let file=path.join(root,url.pathname==='/'?'index.html':url.pathname);
   try {let body=fs.readFileSync(file);if(file.endsWith('index.html'))body=body.toString().replace('    initApp();','    // Controlled initialization in isolated integration tests.');return route.fulfill({body,contentType:file.endsWith('.js')?'application/javascript':'text/html'});}catch{ return route.abort(); }
 }
 if(url.hostname!=='supabase.test') {if(url.hostname!=='cdn.jsdelivr.net')unexpected.push(req.url());return route.abort();}
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
  return json(route,[...cloud.values()].map(r=>({...r,manufacturing_allocations:[...allocations.values()].filter(a=>a.manufacturing_record_id===r.id)})));
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
 assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);console.log('PASS all integration assertions; no uncaught browser errors; no production requests');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
