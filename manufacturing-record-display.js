/* Read-only presentation of record-specific packaging weights. Never reads masters. */
let manufacturingDisplayWeightSources = new Map();

function captureManufacturingDisplayWeights(indexedRecords) {
  const groups = new Map();
  for (const source of manufacturingRecoverySources(indexedRecords)) {
    const id = manufacturingRecordId(source.record);
    if (!id) continue;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(source);
  }
  // Capture raw evidence before the existing recovery path fills missing weights
  // from current masters. This cache is for presentation only.
  manufacturingDisplayWeightSources = new Map([...groups].map(([id, sources]) => [id, window.MeatHistoryRecovery.canonical(sources)]));
}

function manufacturingDisplaySource(record) {
  const id = manufacturingRecordId(record);
  if (manufacturingDisplayWeightSources.has(id)) return manufacturingDisplayWeightSources.get(id);
  const sources = manufacturingRecoverySources([]).filter(s => id && manufacturingRecordId(s.record) === id);
  return sources.length ? window.MeatHistoryRecovery.canonical(sources) : record;
}

function manufacturingSavedWeightEntries(record) {
  const positive = value => value != null && value !== '' && Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
  const first = (...values) => values.map(positive).find(value => value != null) ?? null;
  const allocations = record.allocations || record.manufacturing_allocations || [];
  let meta = {};
  try { meta = JSON.parse((allocations.find(a => a.allocation_type === 'LEGACY_META') || {}).notes || '{}'); } catch (_) {}
  const saved = { ...meta, ...record };
  const allocationFor = types => allocations.filter(a => types.includes(a.allocation_type));
  const entry = (label, unit, stored, types, weight, count) => {
    let value = first(...stored);
    if (value == null) {
      const values = [...new Set(allocationFor(types).map(a => positive(a.unit_weight_g)).filter(v => v != null))];
      if (values.length > 1) return { label, unit, value: null, estimated: false };
      value = values[0] ?? null;
    }
    if (value != null) return { label, unit, value, estimated: false };
    const amount = positive(weight), quantity = positive(count);
    const inferred = amount != null && quantity != null ? [amount / quantity]
      : [...new Set(allocationFor(types).filter(a => positive(a.calculated_weight_g) != null && positive(a.quantity) != null).map(a => Number(a.calculated_weight_g) / Number(a.quantity)))];
    return { label, unit, value: inferred.length === 1 ? inferred[0] : null, estimated: inferred.length === 1 };
  };
  const entries = [];
  const herbAllocations = allocationFor(['HERB_STANDARD', 'HERB_EVENT']);
  const herb = isCombinedHerbManufacturingRecord(saved) || herbAllocations.length > 0;
  const splitHerb = herb && (saved.herbStandardPackageCount != null || saved.herbEventPieceCount != null || herbAllocations.length > 0);
  const unit = isGibierManufacturingRecord(saved) ? '本' : herb ? (herbRecordOptionId(saved) === 'own:herbEvent' ? '本' : 'パック') : (saved.packagingUnit || (allocationFor(['STANDARD'])[0]?.quantity_unit === 'piece' ? '本' : allocationFor(['STANDARD'])[0]?.quantity_unit === 'package' ? 'パック' : '単位不明'));
  if (splitHerb) {
    entries.push(entry('通常', 'パック', [saved.herbStandardUnitWeightG], ['HERB_STANDARD'], saved.herbStandardFinishedWeightG, saved.herbStandardPackageCount));
    entries.push(entry('イベント', '本', [saved.herbEventUnitWeightG], ['HERB_EVENT'], saved.herbEventFinishedWeightG, saved.herbEventPieceCount));
  } else {
    const event = herb && herbRecordOptionId(saved) === 'own:herbEvent';
    const kindWeight = herb ? (event ? saved.herbEventUnitWeightG : saved.herbStandardUnitWeightG) : null;
    const actual = saved.actualFinishedWeightG ?? saved.finishedWeight;
    const allocated = saved.togeAllocationEnabled ? Number(saved.togeAllocatedWeight) : 0;
    const baseWeight = positive(actual) != null && Number.isFinite(allocated) ? Number(actual) - allocated : null;
    const count = unit === '本' ? (saved.completedCount ?? (isGibierManufacturingRecord(saved) ? Number(saved.smokedCount || 0) + Number(saved.unsmokedCount || 0) : null)) : saved.packageCount;
    entries.push(entry(herb ? (event ? 'イベント' : '通常') : '', herb ? (event ? '本' : 'パック') : unit,
      [kindWeight, saved.savedUnitWeightG, saved.unitWeight, saved.packWeight],
      isGibierManufacturingRecord(saved) ? ['GIBIER_SMOKED', 'GIBIER_UNSMOKED'] : herb ? [event ? 'HERB_EVENT' : 'HERB_STANDARD', 'STANDARD'] : ['STANDARD'], baseWeight, count));
  }
  if (saved.togeAllocationEnabled || allocationFor(['TOUGE']).length) entries.push(entry('峠の茶屋用', '本', [saved.togeUnitWeightG], ['TOUGE'], saved.togeAllocatedWeight, saved.togePieceCount));
  return entries;
}

function manufacturingSavedWeightHtml(entries) {
  return entries.map(e => `${e.label ? escapeHtml(e.label) + '：' : ''}${e.value == null ? '不明' : `${e.value.toLocaleString('ja-JP', { maximumFractionDigits: 3 })}g／${escapeHtml(e.unit)}${e.estimated ? '（推定）' : ''}`}`).join('<br>');
}

function historicalPackagingStandardHtml(record) {
  return `<div class="packaging-standard"><strong>保存時の包装重量</strong><div>${manufacturingSavedWeightHtml(manufacturingSavedWeightEntries(manufacturingDisplaySource(record)))}</div></div>`;
}
