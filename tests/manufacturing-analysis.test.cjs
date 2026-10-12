const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');
const c=vm.createContext({});c.window=c;
vm.runInContext(fs.readFileSync('supabase/app-sync-adapter.js','utf8'),c);
const html=fs.readFileSync('index.html','utf8');
for(const name of ['isCombinedHerbManufacturingRecord','isGibierManufacturingRecord','herbRecordOptionId'])vm.runInContext(html.match(new RegExp('    function '+name+'\\([^]*?\\n    \\}'))[0],c);
vm.runInContext(fs.readFileSync('manufacturing-analysis.js','utf8'),c);
const quantity=r=>JSON.parse(JSON.stringify(c.manufacturingQuantitySummary(r)));
const row=(patch={})=>({id:'a',productId:'ARABIKI',productName:'あらびき',category:'自社レシピ',date:'2026-10-09',preparationWeightG:1000,finishedWeightG:800,quantities:quantity({recipeCode:'ARABIKI',packagingUnit:'パック',packageCount:10}),...patch});
const aggregate=rows=>c.aggregateManufacturingRecords(rows);
test('analysis 1 ordinary packages sum per product',()=>{const g=aggregate([row(),row({quantities:quantity({recipeCode:'ARABIKI',packagingUnit:'パック',packageCount:20})})])[0];assert.equal(g.count,2);assert.equal(g.quantities[0].value,30);});
test('analysis 2 no cross-product quantity total',()=>{const g=aggregate([row(),row({productId:'HERB',quantities:quantity({recipeCode:'HERB',herbStandardPackageCount:0,herbEventPieceCount:161})})]);assert.equal(g.length,2);assert.equal(g.totalQuantity,undefined);});
test('analysis 3 herb quantities remain separate',()=>{const g=aggregate([100,61].map((n,i)=>row({productId:'HERB',quantities:quantity({recipeCode:'HERB',herbStandardPackageCount:i?5:10,herbEventPieceCount:n})})))[0];assert.deepEqual(Array.from(g.quantities,q=>q.value),[15,161]);});
test('analysis 4 gibier breakdown',()=>assert.deepEqual(quantity({recipeKind:'gibier',smokedCount:20,unsmokedCount:10}).map(q=>q.value),[20,10]));
test('analysis 5 weight sums in grams',()=>{const g=aggregate([row(),row({preparationWeightG:3000,finishedWeightG:1500})])[0];assert.equal(g.preparationWeightG,4000);assert.equal(g.finishedWeightG,2300);});
test('analysis 6 weighted yield not arithmetic mean',()=>assert.equal(aggregate([row(),row({preparationWeightG:3000,finishedWeightG:1500})])[0].yieldPercent,57.49999999999999));
test('analysis 7 inclusive date filtering and sort',()=>{const rows=[row(),row({id:'b',date:'2026-09-01'})];assert.equal(c.filterManufacturingRecords(rows,{start:'2026-10-09',end:'2026-10-09'}).length,1);assert.equal(c.filterManufacturingRecords(rows,{order:'oldest'})[0].id,'b');});
test('analysis 8 product filter',()=>assert.equal(c.filterManufacturingRecords([row(),row({productId:'HERB'})],{productId:'HERB'}).length,1));
test('analysis 9 category filter',()=>assert.equal(c.filterManufacturingRecords([row(),row({category:'委託製造'})],{category:'委託製造'}).length,1));
test('analysis 10 real quantity regression fixtures',()=>{for(const [code,n]of [['CHORIZO',37],['ARABIKI',11]])assert.equal(quantity({recipeCode:code,packagingUnit:'パック',packageCount:n,herbStandardPackageCount:0,herbEventPieceCount:0})[0].value,n);assert.deepEqual(quantity({recipeCode:'HERB',herbStandardPackageCount:0,herbEventPieceCount:161}).map(q=>q.value),[0,161]);});
test('missing weights excluded as paired observations; zero retained',()=>{const g=aggregate([row(),row({finishedWeightG:null}),row({preparationWeightG:null}),row({finishedWeightG:0})])[0];assert.equal(g.yieldCount,2);assert.equal(g.yieldPercent,40);assert.equal(g.missingFinished,1);});
test('period boundaries including leap year and January',()=>{assert.equal(c.manufacturingAnalysisPeriod('previous','2026-01-10').start,'2025-12-01');assert.equal(c.manufacturingAnalysisPeriod('month','2024-02-10').end,'2024-02-29');});
test('source input is not mutated and units stay separate within product',()=>{const rows=[row(),row({quantities:[{kind:'ordinary',label:'',unit:'袋',value:2}]})];const before=JSON.stringify(rows);assert.equal(aggregate(rows)[0].quantities.length,2);c.filterManufacturingRecords(rows,{});assert.equal(JSON.stringify(rows),before);});

test('STEP2 month and year boundaries use manufacturing date; no LOT merging',()=>{
  const rows=[row({id:'a',date:'2025-12-31',prepDate:'2026-01-01',lot:'same'}),row({id:'b',date:'2026-01-01',lot:'same'}),row({id:'c',date:'2026-01-31',lot:'same'}),row({id:'d',date:'2026-02-01'})];
  const months=c.manufacturingAnalysisMonths(rows);
  assert.deepEqual(Array.from(months,m=>[m.month,m.count,m.products[0].quantities[0].value]),[['2025-12',1,10],['2026-01',2,20],['2026-02',1,10]]);
});
test('STEP2 monthly quantities preserve product/kind/unit and all dedicated allocations',()=>{
  const rows=[row(),row({productId:'HERB',quantities:quantity({recipeCode:'HERB',herbStandardPackageCount:5,herbEventPieceCount:100,togeAllocationEnabled:true,togePieceCount:12})}),row({productId:'GIBIER',quantities:quantity({recipeKind:'gibier',smokedCount:20,unsmokedCount:30})}),row({quantities:quantity({recipeCode:'ARABIKI',packagingUnit:'本',completedCount:7})})];
  const m=c.manufacturingAnalysisMonths(rows)[0];
  assert.deepEqual(Array.from(m.products.find(g=>g.productId==='HERB').quantities,q=>[q.kind,q.unit,q.value]),[['standard','パック',5],['event','本',100],['toge','本',12]]);
  assert.deepEqual(Array.from(m.products.find(g=>g.productId==='GIBIER').quantities,q=>[q.kind,q.value]),[['smoked',20],['unsmoked',30]]);
  assert.deepEqual(Array.from(m.products.find(g=>g.productId==='ARABIKI').quantities,q=>[q.unit,q.value]),[['パック',10],['本',7]]);
});
test('STEP2 weighted yield, missing month gap, missing weights and genuine zero',()=>{
  const rows=[row({date:'2026-01-01'}),row({date:'2026-01-31',preparationWeightG:3000,finishedWeightG:1500}),row({date:'2026-01-15',finishedWeightG:null}),row({date:'2026-03-01',finishedWeightG:0})];
  const m=c.manufacturingAnalysisMonths(rows);
  assert.ok(Math.abs(m[0].yieldPercent-57.5)<1e-9);assert.equal(m[0].yieldCount,2);assert.equal(m[0].missingFinished,1);
  assert.equal(m[1].count,0);assert.equal(m[1].yieldPercent,null);assert.equal(m[2].yieldPercent,0);
});
test('STEP2 comparison shifts January/year, respects product and category, and excludes dates only for full-month comparison',()=>{
  const rows=[row({date:'2026-01-31'}),row({date:'2025-12-01',finishedWeightG:500}),row({date:'2025-01-01',finishedWeightG:600}),row({date:'2026-01-20',productId:'OTHER'}),row({date:'2026-01-02',category:'委託製造'})];
  const v=c.manufacturingAnalysisComparison(rows,'2026-01',{productId:'ARABIKI',category:'自社レシピ',start:'2026-01-31'});
  assert.equal(v.current.count,1);assert.equal(v.previous.month,'2025-12');assert.equal(v.yearAgo.month,'2025-01');assert.equal(v.previous.yieldPercent,50);assert.equal(v.yearAgo.yieldPercent,60);
  const empty=c.manufacturingAnalysisComparison(rows,'2030-01',{productId:'ARABIKI'});assert.equal(empty.current.count,0);assert.equal(empty.current.yieldPercent,null);
});
test('STEP2 empty and custom periods include explicit gaps; aggregations never mutate input or individual yields',()=>{
  assert.equal(c.manufacturingAnalysisMonths([]).length,0);
  assert.deepEqual(Array.from(c.manufacturingAnalysisMonths([],{start:'2026-01-01',end:'2026-03-31'}),m=>m.count),[0,0,0]);
  const rows=[row({yieldPercent:123})];const before=JSON.stringify(rows);c.manufacturingAnalysisMonths(rows);c.manufacturingAnalysisSummary(rows);c.manufacturingAnalysisComparison(rows,'2026-10');assert.equal(JSON.stringify(rows),before);
});
test('STEP2 absent quantity in one packaging series is not converted to zero',()=>{
  const rows=[row({quantities:[{kind:'ordinary',label:'',unit:'パック',value:null}]}),row({quantities:[{kind:'ordinary',label:'',unit:'本',value:2}]})];
  const g=c.manufacturingAnalysisMonths(rows)[0].products[0];assert.equal(g.quantities[0].count,1);assert.equal(g.quantities[0].missing,1);assert.equal(g.quantities[1].count,1);
});
