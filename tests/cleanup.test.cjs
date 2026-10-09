const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=()=>fs.readFileSync('index.html','utf8')+'\n'+fs.readdirSync('supabase').filter(f=>f.endsWith('.js')).map(f=>fs.readFileSync('supabase/'+f,'utf8')).join('\n');
test('production contains no temporary diagnostic references or targeted LOT exceptions',()=>{
 const code=source();
 for(const token of ['MeatHistoryDiagnostics','history-diagnostics','upsertDiagnosticRecovery','pastManufacturingDiagnostics','manufacturingDiagnosticsVisible','manufacturingDiagnosticRun','collectPastManufacturingDiagnosticSnapshot','runPastManufacturingDiagnostics','showPastManufacturingDiagnostics','waitForIdle','preserveAllocations','20261008-JI-CHORIZO-01','20261008-JI-ARABIKI-01','20261008-JI-HERB-01'])assert.equal(code.includes(token),false,token);
 assert.equal(fs.existsSync('supabase/history-diagnostics.js'),false);
 assert.equal(fs.existsSync('tests/history-diagnostics.test.cjs'),false);
});
test('obsolete recovery score helpers are gone; herb identity classification is retained',()=>{
 const code=source();
 assert.equal(code.includes('cloudLegacyMetaPayload'),false);
 assert.equal(code.includes('function recoveryDataScore'),false);
 assert.match(code,/return Boolean\(record\) && MeatProductionSyncAdapter\.internalCode\(record\) === "HERB";/);
});
