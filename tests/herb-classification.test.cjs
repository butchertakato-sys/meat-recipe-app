const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const context=vm.createContext({});context.window=context;
vm.runInContext(fs.readFileSync('supabase/app-sync-adapter.js','utf8'),context);
const html=fs.readFileSync('index.html','utf8');
const predicate=html.match(/    function isCombinedHerbManufacturingRecord\(record\) \{[\s\S]*?\n    \}/)[0];
vm.runInContext(predicate,context);
const classify=record=>context.isCombinedHerbManufacturingRecord(record);
const zeros={herbStandardPackageCount:0,herbEventPieceCount:0};
for(const [name,code,count] of [['チョリソー','CHORIZO',37],['あらびき','ARABIKI',11]])
 test(`${code}: explicit herb zeros do not hide ${count} packages`,()=>assert.equal(classify({...zeros,recipeName:name,recipeCode:code,packageCount:count}),false));
test('HERB 0 / 161 remains herb',()=>assert.equal(classify({...zeros,recipeName:'ハーブ',recipeCode:'HERB',herbEventPieceCount:161}),true));
test('HERB 0 / 0 remains herb',()=>assert.equal(classify({...zeros,recipeCode:'HERB'}),true));
test('legacy herb identifiers resolve through existing adapter',()=>{
 for(const identity of [{recipeId:'own:herb'},{recipeId:'own:herbProduct'},{recipeId:'own:herbEvent'},{recipeCode:'HERB-P'},{recipeCode:'HERB-E'},{productCode:'PROD_HERB'},{recipeName:'ハーブ'},{lot:'20261008-JI-HERB-01'}])assert.equal(classify({...zeros,...identity}),true,JSON.stringify(identity));
});
test('cheese, additive-free arabiki and commissioned products never become herb from zero fields',()=>{
 for(const code of ['CHEESE','ADDITIVE_FREE_ARABIKI','YAMAGOYA','GIBIER_CENTER','ZANZATEI'])assert.equal(classify({...zeros,recipeCode:code}),false,code);
 for(const recipeId of ['own:chorizo','own:arabiki','own:cheese','own:additiveFreeArabiki'])assert.equal(classify({...zeros,recipeId}),false,recipeId);
 assert.equal(classify(zeros),false);assert.equal(classify(null),false);
});
