const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const c=vm.createContext({});c.window=c;
for(const file of ['supabase/history-recovery.js','supabase/app-sync-adapter.js'])vm.runInContext(fs.readFileSync(file,'utf8'),c);
for(const name of ['calculateGibier','calculateGibierProductionMetrics','inferSavedUnitWeight','manufacturingCountForRecord','isGibierManufacturingRecord']) {
 vm.runInContext(html.match(new RegExp('    function '+name+'\\([^]*?\\n    \\}'))[0],c);
}
test('7000g deer + 3000g pork recipe yields theoretical 12300g without changing formula',()=>{
 const rows=c.calculateGibier(7000,3000);
 assert.equal(rows.reduce((sum,row)=>sum+row.calculated,0),12300);
 assert.deepEqual(Array.from(rows,row=>row.calculated),[7000,3000,2000,192,60,36,12]);
});
test('new gibier fallback is 65g and 162 pieces give exact expected yield',()=>{
 const m=c.calculateGibierProductionMetrics(82,80,12300);
 assert.equal(m.actualCompletedWeight,10530);assert.equal(m.yieldRate,85.60975609756098);
});
test('explicit historical 70g snapshot stays 70g',()=>{
 const r={recipeKind:'gibier',completedCount:162,savedUnitWeightG:70};
 assert.equal(c.inferSavedUnitWeight(r,11340),70);
 assert.equal(c.calculateGibierProductionMetrics(82,80,12300,70).actualCompletedWeight,11340);
});
test('historical snapshot can be inferred from stored finished weight without current master',()=>{
 assert.equal(c.inferSavedUnitWeight({recipeKind:'gibier',completedCount:162},11340),70);
});
test('formal gibier allocation retains 70g when legacy metadata lacks weight',()=>{
 const r=c.MeatHistoryRecovery.fromBundle({record:{id:'past',status:'active'},allocations:[{allocation_type:'GIBIER_SMOKED',quantity:82,unit_weight_g:70},{allocation_type:'GIBIER_UNSMOKED',quantity:80,unit_weight_g:70}]});
 assert.equal(r.savedUnitWeightG,70);assert.equal(r.completedCount,162);
});

test('new local LOT uses maximum suffix including deleted history, never active count',()=>{
 const context=vm.createContext({
   loadManufacturingRecords: options=>{assert.equal(options.includeDeleted,true);return [{lot:'20260728-IT-GIBIER-01',status:'deleted'},{lot:'20260728-IT-GIBIER-03'}];},
   manufacturingIndexedHistory:new Map([['cached',{lot:'20260728-IT-GIBIER-05'}]]),
   recipeCodeForRecipe:()=> 'GIBIER',todayString:()=> '2026-07-28'
 });
 vm.runInContext(html.match(/    function generateManufacturingLot\([^]*?\n    \}/)[0],context);
 assert.equal(context.generateManufacturingLot('2026-07-28','委託製造',{}),'20260728-IT-GIBIER-06');
});

test('local write keeps ID-less tombstone and distinct same-LOT IDs',()=>{
 const before=[{status:'deleted',lot:'old-no-id'},{id:'dead',lot:'same',status:'deleted'}];
 let saved;
 const context=vm.createContext({MANUFACTURING_RECORDS_KEY:'records',readLegacyStorageArray:()=>before,localStorage:{setItem:(_key,value)=>{saved=JSON.parse(value);}}});
 for(const name of ['manufacturingRecordId','saveManufacturingRecords'])vm.runInContext(html.match(new RegExp('    function '+name+'\\([^]*?\\n    \\}'))[0],context);
 context.saveManufacturingRecords([{id:'dead',lot:'same',status:'active'},{id:'other',lot:'same',status:'active'}]);
 assert.equal(saved.length,3);assert.equal(saved.find(r=>r.id==='dead').status,'deleted');assert.equal(saved.find(r=>r.id==='other').status,'active');assert.deepEqual(saved.find(r=>!r.id),before[0]);
});
