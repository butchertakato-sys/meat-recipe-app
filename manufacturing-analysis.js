/* Read-only analysis of canonical history. No persistence or network calls. */
function analysisNumber(value) {
  return value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
}

function manufacturingQuantitySummary(record) {
  const quantities = [];
  const add = (kind, label, unit, value) => quantities.push({ kind, label, unit, value: analysisNumber(value) });
  if (isCombinedHerbManufacturingRecord(record)) {
    const split = record.herbStandardPackageCount != null || record.herbEventPieceCount != null;
    const event = herbRecordOptionId(record) === 'own:herbEvent';
    add('standard', '通常', 'パック', split ? record.herbStandardPackageCount : (event ? 0 : record.packageCount));
    add('event', 'イベント', '本', split ? record.herbEventPieceCount : (event ? record.completedCount : 0));
  } else if (isGibierManufacturingRecord(record)) {
    add('smoked', '燻製', '本', record.smokedCount);
    add('unsmoked', '燻製なし', '本', record.unsmokedCount);
  } else {
    add('ordinary', '', record.packagingUnit || '単位未設定', record.packagingUnit === '本' ? record.completedCount : record.packageCount);
  }
  if (record.togeAllocationEnabled) add('toge', '峠の茶屋用', '本', record.togePieceCount);
  return quantities;
}

function manufacturingAnalysisRecord(record) {
  const code = window.MeatProductionSyncAdapter.internalCode(record);
  const productId = SUPABASE_PRODUCT_TO_LEGACY_ID[code] || packagingProductIdForRecord(record);
  return {
    id: manufacturingRecordId(record),
    productId: productId || `${code}:${record.recipeName || record.product || ''}`,
    productName: productNameForId(productId) || record.recipeName || record.product || code,
    category: record.category || '', date: record.date || '', prepDate: record.prepDate || '', lot: record.lot || '', memo: record.memo || '',
    savedWeights: manufacturingSavedWeightEntries(manufacturingDisplaySource(record)),
    preparationWeightG: analysisNumber(record.theoreticalFinishedWeight),
    finishedWeightG: analysisNumber(record.actualFinishedWeightG ?? record.finishedWeight),
    yieldPercent: analysisNumber(record.actualYieldPercent ?? record.yieldRate),
    quantities: manufacturingQuantitySummary(record)
  };
}

function filterManufacturingRecords(records, filters = {}) {
  return records.filter(r => (!filters.productId || r.productId === filters.productId)
    && (!filters.category || r.category === filters.category)
    && (!filters.start || r.date >= filters.start)
    && (!filters.end || (r.date && r.date <= filters.end)))
    .sort((a, b) => (filters.order === 'oldest' ? 1 : -1) * a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
}

function aggregateManufacturingRecords(records) {
  const groups = new Map();
  for (const r of records) {
    if (!groups.has(r.productId)) groups.set(r.productId, { productId: r.productId, productName: r.productName, count: 0,
      preparationWeightG: 0, finishedWeightG: 0, missingPreparation: 0, missingFinished: 0,
      yieldPreparationG: 0, yieldFinishedG: 0, yieldCount: 0, quantities: [] });
    const g = groups.get(r.productId);
    g.count++;
    if (r.preparationWeightG == null) g.missingPreparation++; else g.preparationWeightG += r.preparationWeightG;
    if (r.finishedWeightG == null) g.missingFinished++; else g.finishedWeightG += r.finishedWeightG;
    // Only paired valid weights contribute to the weighted yield denominator.
    if (r.preparationWeightG > 0 && r.finishedWeightG != null) {
      g.yieldPreparationG += r.preparationWeightG; g.yieldFinishedG += r.finishedWeightG; g.yieldCount++;
    }
    for (const q of r.quantities) {
      let total = g.quantities.find(t => t.kind === q.kind && t.unit === q.unit);
      if (!total) { total = { ...q, value: 0, missing: 0 }; g.quantities.push(total); }
      if (q.value == null) total.missing++; else total.value += q.value;
    }
  }
  return [...groups.values()].map(g => ({ ...g, yieldPercent: g.yieldPreparationG > 0 ? g.yieldFinishedG / g.yieldPreparationG * 100 : null }));
}

function manufacturingAnalysisPeriod(period, today = todayString()) {
  const [year, month] = today.split('-').map(Number);
  const day = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (period === 'year') return { start: day(year, 1, 1), end: day(year, 12, 31) };
  if (period === 'month' || period === 'previous') {
    const m = period === 'previous' ? (month === 1 ? 12 : month - 1) : month;
    const y = period === 'previous' && month === 1 ? year - 1 : year;
    return { start: day(y, m, 1), end: day(y, m, new Date(y, m, 0).getDate()) };
  }
  return { start: '', end: '' };
}

async function showManufacturingAnalysis() {
  setHeader('製造実績・分析', '端末の保存済み履歴', true, showManufacturingRecordTop);
  app.innerHTML = '<section class="section" id="manufacturingAnalysis"><p role="status">履歴を読み込み中…</p></section>';
  const host = document.getElementById('manufacturingAnalysis');
  let indexed = [...manufacturingIndexedHistory.values()];
  let notice = '';
  try {
    if (window.MeatProductionSync) indexed = (await window.MeatProductionSync.getLocalHistory()).map(cachedBundleToManufacturingRecord);
  } catch (_) { notice = '端末DBを読み込めないため、既存キャッシュの履歴を表示しています。'; }
  if (!host.isConnected) return;
  captureManufacturingDisplayWeights(indexed);
  const records = combinedManufacturingHistory(indexed).map(manufacturingAnalysisRecord);
  const products = new Map(PRODUCT_MASTER.map(p => [p.productId, p.productName]));
  records.forEach(r => products.set(r.productId, r.productName));
  const categories = [...new Set([...recordRecipeOptions('自社レシピ'), ...recordRecipeOptions('委託製造')].map(o => o.category))];
  host.innerHTML = `
    <h2>絞り込み</h2><p class="note">日付基準：製造日（既存履歴の date）。保存済み履歴を表示します。最新データの取得は既存の同期操作をご利用ください。</p>
    ${notice ? `<p class="note">${escapeHtml(notice)}</p>` : ''}
    <div class="field-row">
      <label>対象期間<select id="analysisPeriod"><option value="all">すべて</option><option value="month">今月</option><option value="previous">先月</option><option value="year">今年</option><option value="custom">期間指定</option></select></label>
      <label>商品<select id="analysisProduct"><option value="">すべて</option>${[...products].map(([id, name]) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`).join('')}</select></label>
      <label>製造区分<select id="analysisCategory"><option value="">すべて</option>${categories.map(c => `<option>${escapeHtml(c)}</option>`).join('')}</select></label>
      <label>日付順<select id="analysisOrder"><option value="newest">新しい順</option><option value="oldest">古い順</option></select></label>
    </div>
    <div class="field-row" id="analysisDates" hidden><label>開始日<input id="analysisStart" type="date"></label><label>終了日<input id="analysisEnd" type="date"></label></div>
    <p id="analysisStatus" role="status"></p><div id="analysisResults"></div>`;
  const field = name => host.querySelector('#analysis' + name);
  const weight = (value, missing = 0) => `${value == null ? '－' : (value / 1000).toLocaleString('ja-JP', { maximumFractionDigits: 3 }) + ' kg'}${missing ? `（未設定 ${missing}件）` : ''}`;
  const percent = value => value == null ? '－' : value.toFixed(1) + '%';
  const quantities = values => values.map(q => `${escapeHtml(q.label ? q.label + '：' : '')}${q.value == null ? '－' : q.value.toLocaleString('ja-JP')}${escapeHtml(q.unit)}${q.missing ? `（未設定 ${q.missing}件）` : ''}`).join('<br>');
  const table = (headers, body, width) => `<div style="overflow-x:auto" tabindex="0" role="region" aria-label="${headers[0] === '日付' ? '製造記録一覧' : '商品別集計表'}"><table style="min-width:${width}px;width:100%"><thead><tr>${headers.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
  const render = () => {
    const custom = field('Period').value === 'custom';
    field('Dates').hidden = !custom;
    const range = custom ? { start: field('Start').value, end: field('End').value } : manufacturingAnalysisPeriod(field('Period').value);
    if (range.start && range.end && range.start > range.end) {
      field('Status').textContent = '終了日は開始日以降を指定してください。'; field('Results').innerHTML = ''; return;
    }
    const selected = filterManufacturingRecords(records, { ...range, productId: field('Product').value, category: field('Category').value, order: field('Order').value });
    const grouped = aggregateManufacturingRecords(selected);
    field('Status').textContent = `${selected.length}件${range.start ? ` ／ ${range.start} ～ ${range.end}` : ''}`;
    field('Results').innerHTML = `<h2>製造記録一覧</h2>${selected.length ? table(['日付', '仕込み日', '商品', 'LOT', '仕込み重量', '完成重量', '製造数', 'マスタ重量', '歩留まり', '備考'], selected.map(r => `<tr data-analysis-id="${escapeHtml(r.id)}" tabindex="0" style="cursor:pointer"><td>${escapeHtml(r.date.replace(/-/g, '/') || '－')}</td><td>${escapeHtml(r.prepDate.replace(/-/g, '/') || '－')}</td><td><button type="button" class="secondary">${escapeHtml(r.productName)}</button></td><td>${escapeHtml(r.lot || '－')}</td><td>${weight(r.preparationWeightG)}</td><td>${weight(r.finishedWeightG)}</td><td>${quantities(r.quantities)}</td><td>${manufacturingSavedWeightHtml(r.savedWeights)}</td><td>${percent(r.yieldPercent)}</td><td style="white-space:pre-wrap">${escapeHtml(r.memo || '－')}</td></tr>`).join(''), 1200) : '<p class="empty">条件に一致する製造記録はありません。</p>'}
      <h2>商品別集計表</h2><p class="note">仕込み重量＝既存歩留まりの分母（理論重量）。平均歩留まり＝完成重量と正の仕込み重量が揃った記録の総完成重量 ÷ 総仕込み重量 × 100。未設定値は合計から除外し、件数を併記します。</p>
      ${grouped.length ? table(['商品名', '製造回数', '総仕込み重量', '総完成重量', '総製造数', '平均歩留まり'], grouped.map(g => `<tr><td>${escapeHtml(g.productName)}</td><td>${g.count}回</td><td>${weight(g.preparationWeightG, g.missingPreparation)}</td><td>${weight(g.finishedWeightG, g.missingFinished)}</td><td>${quantities(g.quantities)}</td><td>${percent(g.yieldPercent)}<br>対象 ${g.yieldCount}/${g.count}件</td></tr>`).join(''), 800) : '<p class="empty">集計対象はありません。</p>'}`;
    field('Results').querySelectorAll('[data-analysis-id]').forEach(row => {
      const open = () => showManufacturingRecordDetail(row.dataset.analysisId);
      row.addEventListener('click', open);
      row.addEventListener('keydown', event => { if (event.target === row && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); open(); } });
    });
  };
  host.querySelectorAll('select,input').forEach(input => input.addEventListener('change', render));
  render();
}
