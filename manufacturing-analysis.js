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
      if (!total) { total = { ...q, value: 0, missing: 0, count: 0 }; g.quantities.push(total); }
      total.count++;
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

// Aggregates keep product, quantity kind and packaging unit as separate series.
function manufacturingAnalysisSummary(records, groups = aggregateManufacturingRecords(records)) {
  const summary = { count: records.length, preparationWeightG: 0, finishedWeightG: 0,
    missingPreparation: 0, missingFinished: 0, yieldCount: 0, yieldPreparationG: 0, yieldFinishedG: 0 };
  for (const g of groups) for (const key of Object.keys(summary).filter(key => key !== 'count')) summary[key] += g[key];
  summary.yieldPercent = summary.yieldPreparationG > 0 ? summary.yieldFinishedG / summary.yieldPreparationG * 100 : null;
  return summary;
}

function manufacturingAnalysisMonthShift(month, offset) {
  const [y, m] = month.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1 + offset, 1));
  return date.toISOString().slice(0, 7);
}

function manufacturingAnalysisMonths(records, range = {}) {
  const dated = records.filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date));
  const dates = dated.map(r => r.date).sort();
  const first = (range.start || dates[0] || '').slice(0, 7);
  const last = (range.end || dates[dates.length - 1] || '').slice(0, 7);
  if (!first || !last || first > last) return [];
  const byMonth = new Map();
  for (const r of dated) {
    const month = r.date.slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month).push(r);
  }
  const months = [];
  for (let month = first; month <= last; month = manufacturingAnalysisMonthShift(month, 1)) {
    const rows = byMonth.get(month) || [];
    const products = aggregateManufacturingRecords(rows);
    months.push({ month, ...manufacturingAnalysisSummary(rows, products), products });
  }
  return months;
}

function manufacturingAnalysisComparison(records, month, filters = {}) {
  const scoped = filterManufacturingRecords(records, { productId: filters.productId, category: filters.category });
  const summarize = key => {
    const rows = scoped.filter(r => r.date.slice(0, 7) === key);
    const products = aggregateManufacturingRecords(rows);
    return { month: key, ...manufacturingAnalysisSummary(rows, products), products };
  };
  return { current: summarize(month), previous: summarize(manufacturingAnalysisMonthShift(month, -1)), yearAgo: summarize(manufacturingAnalysisMonthShift(month, -12)) };
}

function manufacturingAnalysisCharts(months) {
  if (!months.length) return '<h2>月別製造数グラフ</h2><p>データなし</p><h2>月別歩留まり推移グラフ</h2><p>データなし</p>';
  const quantitySeries = new Map(), yieldSeries = new Map();
  const quantityKey = (g, q) => JSON.stringify([g.productId, q.kind, q.unit]);
  for (const m of months) for (const g of m.products) {
    yieldSeries.set(g.productId, g.productName);
    for (const q of g.quantities) quantitySeries.set(quantityKey(g, q), `${g.productName} ${q.label}（${q.unit}）`);
  }
  const chart = (label, values, line, unit, observations) => {
    const width = Math.max(560, months.length * 84 + 70), height = 260;
    const max = Math.max(1, ...values.filter(v => v != null));
    const x = i => 65 + i * (width - 100) / Math.max(1, months.length - 1);
    const y = v => 205 - v / max * 175;
    let marks = '';
    values.forEach((v, i) => {
      if (v == null) return;
      if (line) {
        if (i && values[i - 1] != null) marks += `<line x1="${x(i - 1)}" y1="${y(values[i - 1])}" x2="${x(i)}" y2="${y(v)}" stroke="#527454" stroke-width="3"/>`;
        marks += `<circle cx="${x(i)}" cy="${y(v)}" r="4" fill="#527454"/>`;
      } else marks += `<rect x="${x(i) - 18}" y="${y(v)}" width="36" height="${205 - y(v)}" fill="#527454"/>`;
    });
    const ticks = [0, .5, 1].map(t => `<text x="48" y="${y(max * t) + 5}" text-anchor="end">${(max * t).toLocaleString('ja-JP', { maximumFractionDigits: 1 })}</text><line x1="55" y1="${y(max * t)}" x2="${width - 20}" y2="${y(max * t)}" stroke="#ddd"/>`).join('');
    return `<figure class="analysis-chart"><figcaption>${escapeHtml(label)}</figcaption><div class="analysis-scroll" tabindex="0" role="region" aria-label="${escapeHtml(label)}"><svg width="${width}" height="${height}" role="img" aria-label="${escapeHtml(label)}。月別数値は下の表に表示。"><text x="5" y="18">${escapeHtml(unit)}</text>${ticks}${marks}${months.map((m, i) => `<text x="${x(i)}" y="235" text-anchor="middle">${m.month}</text>`).join('')}</svg><table><caption>月別集計値</caption><thead><tr><th scope="col">製造年月</th><th scope="col">${line ? '加重平均歩留まり' : '製造数'}</th><th scope="col">対象件数</th></tr></thead><tbody>${months.map((m, i) => `<tr><th scope="row">${m.month}</th><td>${values[i] == null ? 'データなし／未設定' : values[i].toLocaleString('ja-JP', { maximumFractionDigits: 1 }) + escapeHtml(unit)}</td><td>${observations[i].valid}/${observations[i].count}件${observations[i].missing ? `（未設定 ${observations[i].missing}件）` : ''}</td></tr>`).join('')}</tbody></table></div></figure>`;
  };
  const quantities = [...quantitySeries].map(([key, label]) => {
    const [, , unit] = JSON.parse(key);
    const values = months.map(m => {
      for (const g of m.products) for (const q of g.quantities) if (quantityKey(g, q) === key) return q.missing === q.count ? null : q.value;
      return null;
    });
    const observations = months.map(m => {
      const q = m.products.flatMap(g => g.quantities.filter(q => quantityKey(g, q) === key))[0];
      return { valid: q ? q.count - q.missing : 0, count: q?.count || 0, missing: q?.missing || 0 };
    });
    return chart(label, values, false, unit, observations);
  }).join('');
  const yields = [...yieldSeries].map(([id, label]) => chart(label, months.map(m => m.products.find(g => g.productId === id)?.yieldPercent ?? null), true, '%', months.map(m => {
    const g = m.products.find(g => g.productId === id);
    return { valid: g?.yieldCount || 0, count: g?.count || 0 };
  }))).join('');
  return `<h2>月別製造数グラフ</h2><p class="note">商品・数量区分・単位別に表示。記録なし・全件未設定は欠損です。</p><div class="analysis-chart-grid">${quantities || '<p>データなし</p>'}</div><h2>月別歩留まり推移グラフ</h2><p class="note">完成重量と正の理論完成重量が揃う記録の加重平均。欠損月は線をつなぎません。</p><div class="analysis-chart-grid">${yields || '<p>データなし</p>'}</div>`;
}

function manufacturingAnalysisComparisonHtml(comparison) {
  const { current, previous, yearAgo } = comparison;
  const number = (v, unit, digits = 1) => v == null ? '未設定' : v.toLocaleString('ja-JP', { maximumFractionDigits: digits }) + escapeHtml(unit);
  const diff = (a, b, unit, digits) => a == null || b == null ? '比較不可' : (a - b > 0 ? '+' : '') + number(a - b, unit, digits);
  const metrics = [
    { label: '製造回数', get: s => s.count, unit: '回' },
    { label: '総完成重量', get: s => s.count === s.missingFinished ? null : s.finishedWeightG / 1000, unit: 'kg', digits: 3 },
    { label: '加重平均歩留まり', get: s => s.yieldPercent, unit: '%', deltaUnit: 'ポイント' }
  ];
  const keys = new Map();
  for (const s of [current, previous, yearAgo]) for (const g of s.products) for (const q of g.quantities) {
    const key = JSON.stringify([q.kind, q.unit]);
    keys.set(key, { label: `製造数 ${q.label}（${q.unit}）`, unit: q.unit, quantityKey: key, get: s => {
      const g = s.products[0], found = g?.quantities.find(q => JSON.stringify([q.kind, q.unit]) === key);
      return !found || found.missing === found.count ? null : found.value;
    } });
  }
  metrics.splice(1, 0, ...keys.values());
  const cell = (s, metric) => {
    if (!s.count) return 'データなし';
    const observation = metric.quantityKey ? s.products[0]?.quantities.find(q => JSON.stringify([q.kind, q.unit]) === metric.quantityKey) : null;
    return number(metric.get(s), metric.unit, metric.digits) + (observation ? `<br>対象 ${observation.count - observation.missing}/${observation.count}件（未設定 ${observation.missing}件）` : '');
  };
  const delta = (s, metric) => !current.count || !s.count ? 'データなし' : diff(metric.get(current), metric.get(s), metric.deltaUnit || metric.unit, metric.digits);
  return `<div class="analysis-scroll" tabindex="0" role="region" aria-label="期間比較"><table><thead><tr><th scope="col">項目</th><th scope="col">${current.month}</th><th scope="col">前月 ${previous.month}</th><th scope="col">前月との差</th><th scope="col">前年同月 ${yearAgo.month}</th><th scope="col">前年同月との差</th></tr></thead><tbody>${metrics.map(metric => `<tr><th scope="row">${escapeHtml(metric.label)}</th><td>${cell(current, metric)}</td><td>${cell(previous, metric)}</td><td>${delta(previous, metric)}</td><td>${cell(yearAgo, metric)}</td><td>${delta(yearAgo, metric)}</td></tr>`).join('')}</tbody></table></div><p class="note">完成重量未設定：当月 ${current.missingFinished}件／前月 ${previous.missingFinished}件／前年同月 ${yearAgo.missingFinished}件。歩留まり対象：当月 ${current.yieldCount}/${current.count}件／前月 ${previous.yieldCount}/${previous.count}件／前年同月 ${yearAgo.yieldCount}/${yearAgo.count}件。数量未設定は合計から除外します。</p>`;
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
    <p id="analysisStatus" role="status"></p><div id="analysisInsights"></div><div id="analysisResults"></div>`;
  const field = name => host.querySelector('#analysis' + name);
  const weight = (value, missing = 0) => `${value == null ? '－' : (value / 1000).toLocaleString('ja-JP', { maximumFractionDigits: 3 }) + ' kg'}${missing ? `（未設定 ${missing}件）` : ''}`;
  const percent = value => value == null ? '－' : value.toFixed(1) + '%';
  const quantities = values => values.map(q => `${escapeHtml(q.label ? q.label + '：' : '')}${q.value == null ? '－' : q.value.toLocaleString('ja-JP')}${escapeHtml(q.unit)}${q.missing ? `（未設定 ${q.missing}件）` : ''}`).join('<br>');
  const table = (headers, body, width) => `<div style="overflow-x:auto" tabindex="0" role="region" aria-label="${headers[0] === '日付' ? '製造記録一覧' : '商品別集計表'}"><table style="min-width:${width}px;width:100%"><thead><tr>${headers.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
  let insightKey = '', cachedGroups = [], renderKey = '';
  const render = () => {
    const nextRenderKey = JSON.stringify([...host.querySelectorAll('select,input')].map(input => input.value));
    if (renderKey === nextRenderKey) return;
    renderKey = nextRenderKey;
    const custom = field('Period').value === 'custom';
    field('Dates').hidden = !custom;
    const range = custom ? { start: field('Start').value, end: field('End').value } : manufacturingAnalysisPeriod(field('Period').value);
    if (range.start && range.end && range.start > range.end) {
      field('Status').textContent = '終了日は開始日以降を指定してください。'; field('Results').innerHTML = ''; field('Insights').innerHTML = ''; insightKey = ''; return;
    }
    const selected = filterManufacturingRecords(records, { ...range, productId: field('Product').value, category: field('Category').value, order: field('Order').value });
    const key = JSON.stringify([range, field('Product').value, field('Category').value]);
    if (key !== insightKey) cachedGroups = aggregateManufacturingRecords(selected);
    const grouped = cachedGroups;
    field('Status').textContent = `${selected.length}件${range.start ? ` ／ ${range.start} ～ ${range.end}` : ''}`;
    if (key !== insightKey) {
      insightKey = key;
      const summary = manufacturingAnalysisSummary(selected, grouped);
      const months = manufacturingAnalysisMonths(selected, range);
      const month = (range.end || selected.map(r => r.date).sort().pop() || todayString()).slice(0, 7);
      field('Insights').innerHTML = `<h2>集計サマリー</h2><div class="analysis-summary">
        <p>製造回数<strong>${summary.count}回</strong></p>
        <p>総仕込み重量<strong>${weight(summary.count === summary.missingPreparation ? null : summary.preparationWeightG, summary.missingPreparation)}</strong><small>対象 ${summary.count - summary.missingPreparation}/${summary.count}件</small></p>
        <p>総完成重量<strong>${weight(summary.count === summary.missingFinished ? null : summary.finishedWeightG, summary.missingFinished)}</strong><small>対象 ${summary.count - summary.missingFinished}/${summary.count}件</small></p>
        <p>加重平均歩留まり<strong>${percent(summary.yieldPercent)}</strong><small>対象 ${summary.yieldCount}/${summary.count}件</small></p></div>
        ${field('Product').value && grouped.length ? `<p>数量内訳：${quantities(grouped[0].quantities.map(q => ({ ...q, value: q.missing === q.count ? null : q.value })))}</p>` : ''}
        ${manufacturingAnalysisCharts(months)}<h2>前月・前年同月比較</h2>
        <p class="note">基準月：${month}（期間の最終月。すべての場合は該当記録の最新月）。比較は各月の1日〜末日全体を対象とし、期間指定の開始・終了日にかかわらず同じ商品・製造区分で比較します。</p>
        ${field('Product').value ? manufacturingAnalysisComparisonHtml(manufacturingAnalysisComparison(records, month, { productId: field('Product').value, category: field('Category').value })) : '<p>比較する商品を選択してください。</p>'}`;
    }
    field('Results').innerHTML = `<h2>製造記録一覧</h2>${selected.length ? table(['日付', '仕込み日', '商品', 'LOT', '仕込み重量', '完成重量', '製造数', 'マスタ重量', '歩留まり', '備考'], selected.map(r => `<tr data-analysis-id="${escapeHtml(r.id)}" tabindex="0" style="cursor:pointer"><td>${escapeHtml(r.date.replace(/-/g, '/') || '－')}</td><td>${escapeHtml(r.prepDate.replace(/-/g, '/') || '－')}</td><td><button type="button" class="secondary">${escapeHtml(r.productName)}</button></td><td>${escapeHtml(r.lot || '－')}</td><td>${weight(r.preparationWeightG)}</td><td>${weight(r.finishedWeightG)}</td><td>${quantities(r.quantities)}</td><td>${manufacturingSavedWeightHtml(r.savedWeights)}</td><td>${percent(r.yieldPercent)}</td><td style="white-space:pre-wrap">${escapeHtml(r.memo || '－')}</td></tr>`).join(''), 1200) : '<p class="empty">条件に一致する製造記録はありません。</p>'}
      <h2>商品別集計表</h2><p class="note">仕込み重量＝既存歩留まりの分母（理論重量）。平均歩留まり＝完成重量と正の仕込み重量が揃った記録の総完成重量 ÷ 総仕込み重量 × 100。未設定値は合計から除外し、件数を併記します。</p>
      ${grouped.length ? table(['商品名', '製造回数', '総仕込み重量', '総完成重量', '総製造数', '平均歩留まり'], grouped.map(g => `<tr><td>${escapeHtml(g.productName)}</td><td>${g.count}回</td><td>${weight(g.count === g.missingPreparation ? null : g.preparationWeightG, g.missingPreparation)}</td><td>${weight(g.count === g.missingFinished ? null : g.finishedWeightG, g.missingFinished)}</td><td>${quantities(g.quantities.map(q => ({ ...q, value: q.missing === q.count ? null : q.value })))}</td><td>${percent(g.yieldPercent)}<br>対象 ${g.yieldCount}/${g.count}件</td></tr>`).join(''), 800) : '<p class="empty">集計対象はありません。</p>'}`;
    field('Results').querySelectorAll('[data-analysis-id]').forEach(row => {
      const open = () => showManufacturingRecordDetail(row.dataset.analysisId);
      row.addEventListener('click', open);
      row.addEventListener('keydown', event => { if (event.target === row && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); open(); } });
    });
  };
  host.querySelectorAll('select,input').forEach(input => input.addEventListener('change', render));
  render();
}
