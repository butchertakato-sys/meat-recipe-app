const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const c = vm.createContext({}); c.window = c;
vm.runInContext(fs.readFileSync('supabase/app-sync-adapter.js', 'utf8'), c);
vm.runInContext(fs.readFileSync('supabase/history-recovery.js', 'utf8'), c);
const html = fs.readFileSync('index.html', 'utf8');
for (const name of ['isCombinedHerbManufacturingRecord', 'isGibierManufacturingRecord', 'herbRecordOptionId']) vm.runInContext(html.match(new RegExp('    function ' + name + '\\([^]*?\\n    \\}'))[0], c);
c.escapeHtml = String; c.manufacturingRecordId = r => r.id;
c.manufacturingRecoverySources = () => [];
vm.runInContext(fs.readFileSync('manufacturing-record-display.js', 'utf8'), c);
const text = r => c.manufacturingSavedWeightHtml(c.manufacturingSavedWeightEntries(r));
const gibier = { recipeKind: 'gibier', completedCount: 162, smokedCount: 82, unsmokedCount: 80, packagingUnit: '本' };
test('display keeps explicit 65g and 70g snapshots and all input values', () => {
  for (const n of [65, 70]) {
    const r = { ...gibier, savedUnitWeightG: n, actualFinishedWeightG: 162 * n, actualYieldPercent: 162 * n / 12300 * 100 };
    const before = JSON.stringify(r); assert.equal(text(r), n + 'g／本'); assert.equal(JSON.stringify(r), before);
  }
});
test('display never consults current packaging masters', () => {
  c.loadPackagingMaster = () => { throw Error('master read forbidden'); };
  assert.equal(text({ ...gibier, savedUnitWeightG: 70 }), '70g／本');
  assert.equal(text(gibier), '不明');
});
test('record allocations and legacy metadata provide saved weights', () => {
  assert.equal(text({ ...gibier, allocations: [{ allocation_type: 'GIBIER_SMOKED', unit_weight_g: 70 }] }), '70g／本');
  assert.equal(text({ ...gibier, allocations: [{ allocation_type: 'LEGACY_META', notes: '{"savedUnitWeightG":65}' }] }), '65g／本');
});
test('explicit snapshot wins over conflicting allocations; ambiguous allocations are unknown', () => {
  const allocations = [{ allocation_type: 'GIBIER_SMOKED', unit_weight_g: 65 }, { allocation_type: 'GIBIER_UNSMOKED', unit_weight_g: 70 }];
  assert.equal(text({ ...gibier, allocations }), '不明');
  assert.equal(text({ ...gibier, savedUnitWeightG: 70, allocations }), '70g／本');
});
test('weight divided by saved quantity is clearly estimated; invalid evidence is unknown', () => {
  assert.equal(text({ ...gibier, finishedWeight: 10530 }), '65g／本（推定）');
  for (const value of [null, '', NaN, -1, 0]) assert.equal(text({ ...gibier, savedUnitWeightG: value }), '不明');
  assert.equal(text({ ...gibier, completedCount: 0, finishedWeight: 10530 }), '不明');
});
test('herb standard and event snapshots stay distinct, including zero-production components', () => {
  assert.equal(text({ recipeCode: 'HERB', herbStandardPackageCount: 0, herbEventPieceCount: 161, herbStandardUnitWeightG: 180, herbEventUnitWeightG: 35 }), '通常：180g／パック<br>イベント：35g／本');
});
test('allocation-only herb records keep both bases; allocation calculation is marked estimated', () => {
  assert.equal(text({ allocations: [{ allocation_type: 'HERB_STANDARD', unit_weight_g: 180 }, { allocation_type: 'HERB_EVENT', unit_weight_g: 35 }] }), '通常：180g／パック<br>イベント：35g／本');
  assert.equal(text({ ...gibier, allocations: [{ allocation_type: 'GIBIER_SMOKED', quantity: 82, calculated_weight_g: 5740 }] }), '70g／本（推定）');
});
test('legacy single herb event snapshot and inferred weight use piece quantities', () => {
  const r = { category: '自社レシピ', recipeCode: 'HERB', recipeId: 'own:herbEvent', completedCount: 20 };
  assert.equal(text({ ...r, savedUnitWeightG: 35 }), 'イベント：35g／本');
  assert.equal(text({ ...r, finishedWeight: 700 }), 'イベント：35g／本（推定）');
});
test('mixed herb total does not manufacture missing component weights', () => {
  assert.equal(text({ recipeCode: 'HERB', herbStandardPackageCount: 10, herbEventPieceCount: 20, finishedWeight: 2500 }), '通常：不明<br>イベント：不明');
  assert.equal(text({ recipeCode: 'HERB', herbStandardPackageCount: 10, herbEventPieceCount: 20, herbStandardFinishedWeightG: 1800 }), '通常：180g／パック（推定）<br>イベント：不明');
});
test('ordinary product and allocations keep package units', () => {
  assert.equal(text({ recipeCode: 'ARABIKI', packagingUnit: '袋', savedUnitWeightG: 180 }), '180g／袋');
  assert.equal(text({ allocations: [{ allocation_type: 'STANDARD', quantity_unit: 'package', unit_weight_g: 200 }] }), '200g／パック');
});
test('toge component is separated and subtracted before estimating main unit weight', () => {
  assert.equal(text({ packagingUnit: 'パック', packageCount: 10, finishedWeight: 2150, togeAllocationEnabled: true, togeAllocatedWeight: 350, togePieceCount: 10 }), '180g／パック（推定）<br>峠の茶屋用：35g／本（推定）');
});
test('display evidence ignores weights injected by existing current-master recovery', () => {
  const raw = { id: 'unknown', ...gibier };
  c.manufacturingRecoverySources = () => [{ source: 'local', record: raw }];
  c.captureManufacturingDisplayWeights([]);
  assert.match(c.historicalPackagingStandardHtml({ ...raw, savedUnitWeightG: 65 }), /不明/);
  const inferred = { ...raw, id: 'estimated', finishedWeight: 11340 };
  c.manufacturingRecoverySources = () => [{ source: 'local', record: inferred }];
  c.captureManufacturingDisplayWeights([]);
  assert.match(c.historicalPackagingStandardHtml({ ...inferred, savedUnitWeightG: 70 }), /70g／本（推定）/);
});
