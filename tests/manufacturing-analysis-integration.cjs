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
   try{let body=fs.readFileSync(file);if(file.endsWith('index.html'))body=body.toString().replace('    initApp();','    // Isolated tests initialize offline.');return route.fulfill({body,contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html'});}catch{return route.abort();}
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
  const baseline=await page.evaluate(()=>{
    const capture=()=>({html:app.innerHTML,width:app.getBoundingClientRect().width,headerWidth:topbar.getBoundingClientRect().width,background:getComputedStyle(document.body).backgroundColor,styles:[...app.querySelectorAll('h2,button,input,select')].slice(0,12).map(n=>{const s=getComputedStyle(n);return [s.color,s.backgroundColor,s.fontSize,s.padding,s.borderRadius];})});
    showHome();const home=capture();showManufacturingRecordForm();const form=capture();showHome();return {home,form};
  });
  const before=await page.evaluate(async()=>({storage:localStorage.getItem('manufacturingRecords'),db:await MeatProductionSync.getLocalHistory()}));
  await page.evaluate(()=>showManufacturingAnalysis());
  assert.equal(await page.locator('#analysisDates').isVisible(),false,'preset hides custom date inputs');
  assert.equal(await page.locator('#analysisSummaryDetails[open],#analysisComparisonDetails[open]').count(),0);
  assert.equal(await page.locator('[data-analysis-id]').count(),records.length-1);assert.equal(await page.locator('[data-analysis-id="deleted"]').count(),0);
  assert.deepEqual(await page.locator('#manufacturingAnalysis h2').allTextContents(), ['絞り込み','製造記録一覧','商品別集計表','集計サマリー','前月・前年同月比較']);
  assert.equal(await page.evaluate(()=>{
    const list=document.querySelector('[aria-label="製造記録一覧"]'),table=document.querySelector('[aria-label="商品別集計表"]'),insights=document.querySelector('#analysisInsights');
    return list.getBoundingClientRect().top<table.getBoundingClientRect().top && table.getBoundingClientRect().top<insights.getBoundingClientRect().top;
  }),true,'list and product table precede graphs visually');
  const productTable=page.locator('[aria-label="商品別集計表"]');
  assert.deepEqual(await productTable.locator('thead th').allTextContents(), ['商品名','製造回数','総仕込み重量','総完成重量','総製造数','加重平均歩留まり','構成比']);
  assert.deepEqual(await page.locator('[aria-label="製造記録一覧"] thead th').allTextContents(), ['製造日','仕込み日','商品','LOT','仕込み重量','完成重量','製造数','保存時マスタ重量','歩留まり','備考']);
  assert.deepEqual(await productTable.locator('tfoot tr').locator('th,td').allTextContents(), ['総計','8回','10 kg','5 kg（未設定 1件）','商品・数量区分・単位別の内訳を参照','55.6%対象 7/8件','100.0%']);
  const shares=await productTable.locator('.analysis-share').evaluateAll(nodes=>nodes.map(n=>({value:Number(n.textContent.replace('%','')),width:Number(n.querySelector('.analysis-share-track > span').style.width.replace('%',''))})));
  assert.equal(shares.reduce((sum,s)=>sum+s.value,0),100);assert.deepEqual(shares.map(s=>s.width).sort((a,b)=>a-b),[16,16,68]);
  const herbGroup=productTable.locator('[data-analysis-product="PROD_HERB"]');assert.match(await herbGroup.innerText(),/通常：5パック/);assert.match(await herbGroup.innerText(),/イベント：100本/);assert.match(await herbGroup.innerText(),/峠の茶屋用：12本/);
  assert.match(await page.locator('[data-analysis-id="a"] td').nth(1).innerText(),/2025\/12\/01/);assert.match(await page.locator('[data-analysis-id="a"] td').nth(7).innerText(),/180g／パック/);
  await page.selectOption('#analysisProduct','PROD_ARABIKI');
  await page.selectOption('#analysisPeriod','custom');assert.equal(await page.locator('#analysisDates').isVisible(),true);
  async function date(id,value){await page.fill(id,value);await page.locator(id).dispatchEvent('change');}
  await date('#analysisStart','2026-01-01');await date('#analysisEnd','2026-03-31');
  assert.equal(await page.locator('[data-analysis-id]').count(),4);
  assert.equal(await productTable.locator('tbody tr').count(),1);assert.match(await productTable.locator('tfoot').innerText(),/4回/);assert.match(await productTable.locator('tfoot').innerText(),/2.3 kg（未設定 1件）/);assert.match(await productTable.locator('tfoot').innerText(),/46.0%/);
  assert.match(await productTable.locator('tbody').innerText(),/20パック/);assert.match(await page.locator('#analysisStatus').innerText(),/2026-01-01 ～ 2026-03-31/);

  assert.equal(await page.locator('#manufacturingAnalysis svg,.analysis-chart').count(),0);
  assert.match(await page.locator('[data-analysis-id="a"]').innerText(),/123.0%/,'individual stored yield unchanged');
  await date('#analysisEnd','2026-01-31');
  await page.selectOption('#analysisProduct','');
  assert.equal(await page.locator('[data-analysis-id]').count(),4);assert.match(await productTable.locator('tfoot').innerText(),/3.9 kg/);
  const janShares=await productTable.locator('.analysis-share').evaluateAll(nodes=>nodes.map(n=>Number(n.textContent.replace('%',''))));assert.equal(janShares.reduce((sum,n)=>sum+n,0),100);
  assert.match(await productTable.locator('[data-analysis-product="PROD_ARABIKI"]').innerText(),/59.0%/);assert.match(await productTable.locator('[data-analysis-product="PROD_HERB"]').innerText(),/20.5%/);
  await page.selectOption('#analysisProduct','PROD_ARABIKI');

  await page.locator('#analysisComparisonDetails > summary').click();
  const comparison=page.locator('[aria-label="期間比較"]');assert.match(await comparison.innerText(),/2025-12/);assert.match(await comparison.innerText(),/2025-01/);assert.match(await comparison.innerText(),/7.5ポイント/);assert.match(await comparison.innerText(),/-2.5ポイント/);
  assert.equal(await page.locator('[data-analysis-id]').count(),2,'same LOT distinct IDs retained');
  await page.evaluate(()=>window.originalComparison=document.querySelector('#analysisComparisonDetails'));
  await page.selectOption('#analysisOrder','oldest');assert.equal(await page.evaluate(()=>originalComparison===document.querySelector('#analysisComparisonDetails')),true,'sort does not redraw insights');
  await page.selectOption('#analysisProduct','PROD_HERB');assert.match(await productTable.innerText(),/5パック/);assert.match(await productTable.innerText(),/100本/);assert.match(await productTable.innerText(),/12本/);
  await page.selectOption('#analysisProduct','PROD_GIBIER_CENTER');assert.match(await productTable.innerText(),/燻製：20本/);assert.match(await productTable.innerText(),/燻製なし：30本/);
  await page.selectOption('#analysisCategory','自社レシピ');assert.equal(await page.locator('[data-analysis-id]').count(),0);assert.match(await comparison.innerText(),/データなし/);
  await page.selectOption('#analysisCategory','');await page.selectOption('#analysisProduct','PROD_ARABIKI');
  await date('#analysisStart','2030-01-01');await date('#analysisEnd','2030-01-31');await page.locator('#analysisComparisonDetails > summary').click();assert.equal(await page.locator('[data-analysis-id]').count(),0);assert.match(await comparison.innerText(),/データなし/);

  await date('#analysisStart','2026-03-01');await date('#analysisEnd','2026-03-01');
  assert.match(await productTable.locator('tbody').innerText(),/0 kg/);assert.match(await productTable.locator('tbody').innerText(),/算出不可（総完成重量0）/);
  await date('#analysisStart','2026-03-02');await date('#analysisEnd','2026-03-02');assert.match(await productTable.locator('tbody').innerText(),/未設定/);assert.doesNotMatch(await productTable.locator('tbody').innerText(),/0 kg/);assert.match(await productTable.locator('tfoot').innerText(),/未設定/);
  await page.selectOption('#analysisPeriod','all');await page.selectOption('#analysisProduct','');
  for(const [width,height] of [[390,844],[375,812],[768,1024],[820,1180],[1024,768],[1366,1024]]) {
    await page.setViewportSize({width,height});await page.evaluate(()=>scrollTo(0,0));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`page fits ${width}px`);
    const mainWidth=await page.locator('#app').evaluate(n=>n.getBoundingClientRect().width);assert.ok(mainWidth>=width-1,'analysis uses available width');
    assert.equal(await page.locator('#topbar').evaluate(n=>n.getBoundingClientRect().width),mainWidth);
    const filters=await page.locator('.analysis-filters label').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().top));
    assert.equal(new Set(filters).size,width>600?1:2,'compact filter grid');
    assert.ok(await page.locator('.analysis-records').evaluate(n=>n.getBoundingClientRect().top)<height*.65,'list visible near top');
    for(const label of ['製造記録一覧','商品別集計表']) {
      const region=page.locator(`[aria-label="${label}"]`);await region.focus();
      const overflowing=await region.evaluate(n=>n.scrollWidth>n.clientWidth);
      assert.equal(overflowing,width<1024 || label==='製造記録一覧' && width<1366,'scroll only when table cannot fit');
      await region.evaluate(n=>n.scrollLeft=n.scrollWidth);
      if(overflowing)assert.ok(await region.evaluate(n=>n.scrollLeft)>0);
      const sticky=label==='製造記録一覧'?region.locator('tbody tr').first().locator('td').nth(2):region.locator('tbody th').first();
      const position=await sticky.evaluate(n=>({left:n.getBoundingClientRect().left,parent:n.closest('[role="region"]').getBoundingClientRect().left}));
      if(overflowing)assert.ok(Math.abs(position.left-position.parent)<3,`product identity stays visible when scrolled: ${width} ${label} ${JSON.stringify(position)}`);
      assert.equal(await region.locator('thead th').first().evaluate(n=>getComputedStyle(n).position),'sticky');
      assert.equal(await region.locator('td,th').evaluateAll(nodes=>nodes.every(n=>parseFloat(getComputedStyle(n).fontSize)>=13)),true);
      assert.equal(await region.locator('td,th').evaluateAll(nodes=>nodes.every(cell=>{
        const box=cell.getBoundingClientRect(),walker=document.createTreeWalker(cell,NodeFilter.SHOW_TEXT);
        for(let text; text=walker.nextNode();)if(text.textContent.trim()){
          const range=document.createRange();range.selectNodeContents(text);
          for(const r of range.getClientRects()) if(r.left<box.left-1 || r.right>box.right+1)return false;
        }return true;
      })),true,'text fits columns without overlap '+label);
      await region.evaluate(n=>n.scrollLeft=0);
    }
    assert.equal(await page.locator('[data-analysis-id] button').evaluateAll(nodes=>nodes.every(n=>n.getBoundingClientRect().height>=44)),true);
    assert.equal(await productTable.locator('tbody td').first().evaluate(n=>getComputedStyle(n).textAlign),'right');
    assert.equal(await page.locator('#manufacturingAnalysis svg').count(),0);
    await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`/tmp/analysis-ui-${width}.png`,fullPage:true});
  }
  await page.setViewportSize({width:820,height:1180});
  const after=await page.evaluate(async()=>({storage:localStorage.getItem('manufacturingRecords'),db:await MeatProductionSync.getLocalHistory()}));assert.deepEqual(after,before);assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  await page.locator('[data-analysis-id="a"]').click();await page.waitForSelector('#recordDetailText');
  assert.equal(await page.locator('#app').evaluate(n=>n.getBoundingClientRect().width),700,'detail restores shared width');
  const restored=await page.evaluate(()=>{
    const capture=()=>({html:app.innerHTML,width:app.getBoundingClientRect().width,headerWidth:topbar.getBoundingClientRect().width,background:getComputedStyle(document.body).backgroundColor,styles:[...app.querySelectorAll('h2,button,input,select')].slice(0,12).map(n=>{const s=getComputedStyle(n);return [s.color,s.backgroundColor,s.fontSize,s.padding,s.borderRadius];})});
    showHome();const home=capture();showManufacturingRecordForm();const form=capture();return {home,form};
  });assert.deepEqual(restored,baseline,'home and manufacturing form markup/styles unchanged after analysis navigation');
  console.log('PASS layout: table-focused UI without monthly graphs, required headers, finished-weight shares sum 100%, weighted totals, missing/zero, quantity kinds, dates/saved weights, consistent filters, iPad horizontal scroll/sticky headings');
  console.log('PASS STEP2 browser: filters, quantities, weighted yields, zero/missing, month comparisons, same LOT separate IDs, deletion, existing list/table/detail, responsive 390/768/820/1024/1366px, no sort redraw, collapsible comparison, scoped styles, offline, zero network, unchanged storage and IndexedDB');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
