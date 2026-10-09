const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ctx = vm.createContext({ window: {}, console });
for (const name of ['history-recovery.js', 'app-sync-adapter.js', 'record-observation.js']) {
  vm.runInContext(fs.readFileSync('supabase/' + name, 'utf8'), ctx);
}
const O = ctx.window.MeatRecordObservation;
const plain = data => JSON.parse(JSON.stringify(data));

test('observation retains missing, undefined, null, empty, zero and positive values in copied JSON', () => {
  const row = { undef: undefined, nil: null, empty: '', zero: 0, positive: 65 };
  assert.deepEqual(plain(O.fields(row, ['missing', ...Object.keys(row)])), {
    missing: { type: 'missing' }, undef: { type: 'undefined' }, nil: { type: 'null', value: null },
    empty: { type: 'empty-string', value: '' }, zero: { type: 'number', value: 0 }, positive: { type: 'number', value: 65 }
  });
});
test('observation preserves separate same-LOT IDs and formal/meta discrepancies instead of repairing them', () => {
  const local = Object.fromEntries(['manufacturingRecords', 'meatRecipeApp.manufacturingRecords.v1', 'savedRecipes',
    'meatRecipeApp.savedRecipeCalculations.v1', 'packagingMaster.v1', 'meatRecipeApp.supabaseMasters.v1',
    'meatRecipeApp.deviceId.v1', 'meatRecipeApp.crossDeviceSyncStatus.v1'].map(key => [key, { state: 'missing', raw: null }]));
  const a = { id: 'a', lot_number: '20260728-IT-GIBIER-01', manufacturing_date: '2026-07-28', status: 'deleted' };
  const b = { ...a, id: 'b', status: 'active' };
  const allocations = [{ id: 'meta', manufacturing_record_id: 'a', allocation_type: 'LEGACY_META',
    notes: JSON.stringify({ lot: '20260728-IT-GIBIER-02', savedUnitWeightG: 70 }) },
    { id: 'smoked', manufacturing_record_id: 'a', allocation_type: 'GIBIER_SMOKED', quantity: 82, unit_weight_g: 65 }];
  const input = { local, indexed: { state: 'read', records: [a, b], allocations, meta: [] }, cloud: { state: 'unavailable', tables: {} } };
  const before = JSON.stringify(input);
  const report = plain(O.build(input.local, input.indexed, input.cloud));
  assert.equal(report.indexedDB.targetRecords.length, 2);
  assert.equal(report.indexedDB.targetRecords[0].fields.status.value, 'deleted');
  assert.equal(report.indexedDB.targetRecords[1].fields.status.value, 'active');
  assert.equal(report.indexedDB.targetRecords[0].legacyMeta[0].parsed.savedUnitWeightG, 70);
  assert.equal(report.indexedDB.targetRecords[0].allocations[1].raw.unit_weight_g, 65);
  assert.equal(JSON.stringify(input), before);
});
