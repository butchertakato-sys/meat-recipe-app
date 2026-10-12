// Browser UI and IndexedDB verification. All requests intercepted; no production access.
const {chromium}=require('playwright-core');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try {
  const context=await browser.newContext({viewport:{width:820,height:1180}});const external=[],errors=[];
  await context.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.hostname!=='app.test'){if(url.hostname!=='cdn.jsdelivr.net')external.push(url.href);return route.abort();}
   const file=path.join(root,url.pathname==='/'?'index.html':url.pathname);
   try{let body=fs.readFileSync(file);if(file.endsWith('index.html'))body=body.toString().replace('    initApp();','    // Isolated tests initialize offline.');return route.fulfill({body,contentType:file.endsWith('.js')?'application/javascript':'text/html'});}catch{return route.abort();}
  });
  await context.addInitScript(()=>{
   window.MEAT_SUPABASE_CONFIG={enabled:true,url:'https://supabase.test',publishableKey:'test',businessId:'business'};
   Object.defineProperty(navigator,'onLine',{get:()=>false});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('http://app.test/');
  const records=await page.evaluate(async()=>{
   await initializeManufacturingSync();
   const make=(id,date,patch={})=>({id,manufacturingRecordId:id,cloudRecordId:id,status:'active',recipeId:'own:arabiki',recipeCode:'ARABIKI',recipeName:'あらびき',category:'自社レシピ',date,prepDate:'2025-12-01',lot:'SAME-LOT',packagingUnit:'パック',packageCount:10,theoreticalFinishedWeight:1000,finishedWeight:800,yieldRate:123,savedUnitWeightG:180,createdAt:date+'T00:00:00Z',updatedAt:date+'T00:00:00Z',...patch});
   const rows=[make('a','2026-01-01'),make('b','2026-01-31',{theoreticalFinishedWeight:3000,finishedWeight:1500}),make('c','2026-03-01',{finishedWeight:0,packageCount:0}),make('missing','2026-03-02',{finishedWeight:null,packageCount:null}),make('previous','2025-12-31',{finishedWeight:500}),make('year','2025-01-31',{finishedWeight:600}),make('deleted','2026-01-01',{status:'deleted',packageCount:999}),make('herb','2026-01-10',{recipeId:'own:herb',recipeCode:'HERB',recipeName:'ハーブ',herbStandardPackageCount:5,herbEventPieceCount:100,togeAllocationEnabled:true,togePieceCount:12}),make('gibier','2026-01-10',{recipeId:'client:gibier',recipeCode:'GIBIER_CENTER',recipeKind:'gibier',recipeName:'ジビエセンター',category:'委託製造',packagingUnit:'本',smokedCount:20,unsmokedCount:30,completedCount:50})];
   localStorage.setItem('manufacturingRecords',JSON.stringify(rows));
   return rows;
  });
  const before=await page.evaluate(async()=>({storage:localStorage.getItem('manufacturingRecords'),db:await MeatProductionSync.getLocalHistory()}));
  await page.evaluate(()=>showManufacturingAnalysis());
  assert.equal(await page.locator('[data-analysis-id]').count(),records.length-1);assert.equal(await page.locator('[data-analysis-id="deleted"]').count(),0);
  await page.selectOption('#analysisProduct','PROD_ARABIKI');
  await page.selectOption('#analysisPeriod','custom');
  async function date(id,value){await page.fill(id,value);await page.locator(id).dispatchEvent('change');}
  await date('#analysisStart','2026-01-01');await date('#analysisEnd','2026-03-31');
  assert.equal(await page.locator('[data-analysis-id]').count(),4);
  const charts=page.locator('.analysis-chart');assert.equal(await charts.count(),2);
  const qty=await charts.nth(0).innerText();assert.match(qty,/2026-01\s+20パック/);assert.match(qty,/2026-02\s+データなし/);assert.match(qty,/2026-03\s+0パック/);assert.match(qty,/未設定 1件/);
  const yieldChart=charts.nth(1);assert.match(await yieldChart.innerText(),/57.5%/);assert.match(await yieldChart.innerText(),/2026-03\s+0%/);
  assert.equal(await yieldChart.locator('svg circle').count(),2);assert.equal(await yieldChart.locator('svg line[stroke="#527454"]').count(),0,'gap not bridged');
  assert.match(await page.locator('[data-analysis-id="a"]').innerText(),/123.0%/,'individual stored yield unchanged');
  await date('#analysisEnd','2026-01-31');
  const comparison=page.locator('[aria-label="期間比較"]');assert.match(await comparison.innerText(),/2025-12/);assert.match(await comparison.innerText(),/2025-01/);assert.match(await comparison.innerText(),/7.5ポイント/);assert.match(await comparison.innerText(),/-2.5ポイント/);
  assert.equal(await page.locator('[data-analysis-id]').count(),2,'same LOT distinct IDs retained');
  await page.evaluate(()=>window.originalChart=document.querySelector('.analysis-chart'));
  await page.selectOption('#analysisOrder','oldest');assert.equal(await page.evaluate(()=>originalChart===document.querySelector('.analysis-chart')),true,'sort does not redraw insights');
  await page.selectOption('#analysisProduct','PROD_HERB');assert.match(await charts.nth(0).innerText(),/5パック/);assert.match(await charts.nth(1).innerText(),/100本/);assert.match(await charts.nth(2).innerText(),/12本/);
  await page.selectOption('#analysisProduct','PROD_GIBIER_CENTER');assert.match(await charts.nth(0).innerText(),/燻製（本）/);assert.match(await charts.nth(1).innerText(),/燻製なし（本）/);
  await page.selectOption('#analysisCategory','自社レシピ');assert.equal(await page.locator('[data-analysis-id]').count(),0);assert.match(await page.locator('#analysisInsights').innerText(),/データなし/);
  await page.selectOption('#analysisCategory','');await page.selectOption('#analysisProduct','PROD_ARABIKI');
  await date('#analysisStart','2030-01-01');await date('#analysisEnd','2030-01-31');assert.equal(await page.locator('[data-analysis-id]').count(),0);assert.match(await comparison.innerText(),/データなし/);
  await page.selectOption('#analysisPeriod','all');await page.selectOption('#analysisProduct','');
  for(const width of [768,820,1024,1366,390]){await page.setViewportSize({width,height:1180});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`page fits ${width}px`);assert.equal(await page.locator('.analysis-chart').evaluateAll(nodes=>nodes.every(n=>n.getBoundingClientRect().right<=innerWidth)),true);}
  await page.setViewportSize({width:820,height:1180});await page.screenshot({path:'/tmp/manufacturing-analysis-ipad.png',fullPage:true});
  const after=await page.evaluate(async()=>({storage:localStorage.getItem('manufacturingRecords'),db:await MeatProductionSync.getLocalHistory()}));assert.deepEqual(after,before);assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  await page.locator('[data-analysis-id="a"]').click();await page.waitForSelector('#recordDetailText');
  console.log('PASS STEP2 browser: filters, quantities, weighted yields, gaps/zero/missing, month comparisons, same LOT separate IDs, deletion, existing list/table/detail, responsive 390/768/820/1024/1366px, no sort redraw, offline, zero network, unchanged storage and IndexedDB');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
