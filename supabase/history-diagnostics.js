(function (global) {
  "use strict";
  const TARGETS = [
    { lot: "20261008-JI-CHORIZO-01", name: "チョリソー", code: "CHORIZO" },
    { lot: "20261008-JI-ARABIKI-01", name: "あらびき", code: "ARABIKI" },
    { lot: "20261008-JI-HERB-01", name: "ハーブ", code: "HERB" }
  ];
  const FIELDS = ["id", "cloudRecordId", "syncStatus", "recipeName", "recipeCode", "packageCount", "completedCount", "herbStandardPackageCount", "herbEventPieceCount", "smokedCount", "unsmokedCount", "meatTotal", "finishedWeight", "actualFinishedWeightG", "yieldRate", "actualYieldPercent", "savedRecipeId", "allocation_type", "quantity"];
  const STORAGE_KEYS = { "旧v1製造履歴": "localStorage meatRecipeApp.manufacturingRecords.v1", "現行local製造履歴": "localStorage manufacturingRecords", "IndexedDB製造記録": "IndexedDB manufacturing_records", "IndexedDB内訳": "IndexedDB manufacturing_allocations", "Supabase製造記録": "Supabase manufacturing_records", "Supabase内訳": "Supabase manufacturing_allocations", "旧v1保存済みレシピ": "localStorage meatRecipeApp.savedRecipeCalculations.v1", "現行保存済みレシピ": "localStorage savedRecipes" };
  const SOURCES = ["旧v1製造履歴", "現行local製造履歴", "IndexedDB製造記録", "IndexedDB内訳", "Supabase製造記録", "Supabase内訳", "旧v1保存済みレシピ", "現行保存済みレシピ"];
  const positive = (v) => v != null && v !== "" && Number.isFinite(Number(v)) && Number(v) > 0;
  const formatValue = (v) => v === undefined ? "undefined（項目なし）" : typeof v === "number" && !Number.isFinite(v) ? `${v}（数値不正）` : JSON.stringify(v);
  const lotOf = (r) => r.lot ?? r.lot_number;
  const savedId = (r) => r.savedRecipeId || r.savedCalculationId;
  const nameOf = (r) => String(r.savedRecipeName || r.recipeName || "").replace(/（.*$/, "").trim();

  function inspect(snapshot, target) {
    const entries = [];
    const normalized = [];
    const add = (source, raw, parentId) => entries.push({ source, raw, parentId });
    for (const [key, source, rank] of [["archive", SOURCES[0], "archive"], ["local", SOURCES[1], "local"]]) {
      for (const r of snapshot[key] || []) if (lotOf(r) === target.lot) { add(source, r); normalized.push({ source: rank, record: r }); }
    }
    for (const [key, recordSource, allocationSource, rank] of [["indexed", SOURCES[2], SOURCES[3], "indexed"], ["cloud", SOURCES[4], SOURCES[5], "cloud"]]) {
      for (const bundle of snapshot[key] || []) {
        const r = bundle.record;
        if (lotOf(r) !== target.lot) continue;
        add(recordSource, r);
        if (r.legacy_payload && typeof r.legacy_payload === "object") add(`${recordSource} legacy_payload`, r.legacy_payload, r.id);
        for (const a of bundle.allocations || []) {
          add(allocationSource, a, r.id);
          if (a.allocation_type === "LEGACY_META" && a.notes) {
            try { const raw = JSON.parse(a.notes); if (raw && typeof raw === "object") add(`${allocationSource} LEGACY_META`, raw, r.id); }
            catch (_) { add(`${allocationSource} LEGACY_META解析失敗`, { notes: a.notes }, r.id); }
          }
        }
        normalized.push({ source: rank, record: global.MeatHistoryRecovery.fromBundle(bundle) });
      }
    }
    const records = [...entries.filter((e) => !e.raw.allocation_type).map((e) => e.raw), ...normalized.map((s) => s.record)];
    const savedSources = [
      ...(snapshot.savedArchive || []).map((raw) => ({ source: SOURCES[6], raw })),
      ...(snapshot.savedLocal || []).map((raw) => ({ source: SOURCES[7], raw }))
    ];
    const directIds = new Set(records.map(savedId).filter(Boolean));
    const direct = savedSources.filter(({ raw: r }) => [r.id, r.savedRecipeId, r.cloudSavedRecipeId].some((id) => id && directIds.has(id)));
    const fallback = savedSources.filter(({ raw: s }) => records.some((r) => r.prepDate && r.category && nameOf(r) && s.prepDate === r.prepDate && s.category === r.category && nameOf(s) === nameOf(r)));
    const matched = direct.length ? direct : fallback;
    const matchingSaved = matched.map((e) => e.raw);
    matched.forEach((e) => add(e.source, e.raw));
    const recipeIds = new Set(matchingSaved.map((r) => r.savedRecipeId || r.id));
    const ambiguousSaved = recipeIds.size > 1;
    const keys = target.code === "HERB" ? ["herbStandardPackageCount", "herbEventPieceCount"]
      : target.code === "GIBIER_CENTER" ? ["smokedCount", "unsmokedCount"]
      : [records.some((r) => r.packagingUnit === "本") ? "completedCount" : "packageCount"];
    const candidates = Object.fromEntries(keys.map((key) => [key, []]));
    const invalidQuantities = [];
    let ambiguousQuantity = false;
    for (const e of entries) {
      const unlinked = ambiguousSaved && [SOURCES[6], SOURCES[7]].includes(e.source);
      if (unlinked) {
        if (keys.some((key) => positive(e.raw[key]))) ambiguousQuantity = true;
        continue;
      }
      for (const key of keys) {
        const v = e.raw[key];
        if (v != null && v !== "" && (!["string", "number"].includes(typeof v) || !Number.isFinite(Number(v)) || Number(v) < 0)) invalidQuantities.push(`${e.source} ${key}: ${formatValue(v)}（数量形式不正）`);
      }
      for (const key of keys) if (positive(e.raw[key])) candidates[key].push({ value: Number(e.raw[key]), source: e.source, id: e.raw.id ?? e.parentId });
      const a = e.raw;
      const key = ({ STANDARD: a.quantity_unit === "piece" ? "completedCount" : "packageCount", HERB_STANDARD: "herbStandardPackageCount", HERB_EVENT: "herbEventPieceCount", GIBIER_SMOKED: "smokedCount", GIBIER_UNSMOKED: "unsmokedCount" })[a.allocation_type];
      if (keys.includes(key) && a.quantity != null && a.quantity !== "" && (!["string", "number"].includes(typeof a.quantity) || !Number.isFinite(Number(a.quantity)) || Number(a.quantity) < 0)) invalidQuantities.push(`${e.source} allocation quantity: ${formatValue(a.quantity)}（数量形式不正）`);
      if (keys.includes(key) && positive(a.quantity)) candidates[key].push({ value: Number(a.quantity), source: e.source, id: a.id });
    }
    const conflicts = ambiguousQuantity ? ["保存済みレシピの数量候補を一意に特定できません"] : [];
    const quantities = {};
    for (const key of keys) {
      const values = [...new Set(candidates[key].map((c) => c.value))];
      if (values.length > 1 || values.some((v) => !Number.isInteger(v))) conflicts.push(`${key}: ${values.join(" / ")}`);
      if (values.length === 1 && Number.isInteger(values[0])) quantities[key] = values[0];
    }
    const cloudIds = new Set(normalized.filter((s) => s.source === "indexed" || s.source === "cloud").map((s) => s.record.cloudRecordId).filter(Boolean));
    if (cloudIds.size > 1) conflicts.push(`同一LOTに異なるクラウドID: ${[...cloudIds].join(" / ")}`);
    const incomplete = [...(snapshot.errors || []), ...invalidQuantities];
    for (const e of entries) if (e.source.includes("解析失敗")) incomplete.push(`${e.source}: スナップショットを解析できません`);
    const record = global.MeatHistoryRecovery.restoreSaved(global.MeatHistoryRecovery.canonical(normalized), ambiguousSaved ? [] : matchingSaved);
    // No inferCount / mergeHistory here: candidate inference must never become a quantity.
    Object.assign(record, { lot: target.lot, recipeName: record.recipeName || target.name, recipeCode: record.recipeCode || target.code, category: record.category || "自社レシピ" });
    for (const key of keys) if (quantities[key] != null) record[key] = quantities[key];
    if (target.code !== "HERB") { delete record.herbStandardPackageCount; delete record.herbEventPieceCount; }
    if (target.code === "HERB") {
      for (const key of keys) if (record[key] == null || record[key] === "") record[key] = 0;
    }
    const hasExplicit = Object.keys(quantities).length > 0;
    let inference = null;
    if (!hasExplicit && keys.length === 1) {
      const weight = Number(record.actualFinishedWeightG) > 0 ? Number(record.actualFinishedWeightG) : Number(record.finishedWeight);
      const unit = Number(record.savedUnitWeightG || record.unitWeight || record.packWeight);
      const ratio = weight / unit;
      if (weight > 0 && unit > 0 && Math.round(ratio) > 0 && Math.abs(ratio - Math.round(ratio)) <= 0.01) inference = { weight, unit, count: Math.round(ratio), tolerance: 0.01 };
    }
    const decision = incomplete.length ? "診断未完了（取得失敗あり）" : conflicts.length ? "競合（自動上書きしません）" : hasExplicit ? "明示製造数あり" : "元製造数データなし";
    return { lot: target.lot, name: target.name, entries, candidates, quantities, record, decision, incomplete, sourceErrors: (snapshot.errors || []).slice(), conflicts, inference, ambiguousSaved, canRecover: !incomplete.length && !conflicts.length && hasExplicit,
      result: incomplete.length ? "取得未完了（元データの有無は未確定）" : conflicts.length ? "競合のため自動変更なし" : !hasExplicit ? "手動確認が必要（自動確定なし）" : "未実行" };
  }

  function text(report) {
    const lines = [`${report.name}\nLOT: ${report.lot}`];
    for (const source of SOURCES) {
      const found = report.entries.filter((e) => e.source === source || e.source.startsWith(source + " "));
      const unread = (report.sourceErrors || []).some((e) => e.startsWith(`${source}:`) ||
        (e.startsWith("Supabase:") || e.startsWith("Supabase取得上限")) && source.startsWith("Supabase") ||
        e.startsWith("Supabase内訳未取得") && source === "Supabase内訳" || e.startsWith("IndexedDB:") && source.startsWith("IndexedDB"));
      lines.push(`\n${source}（${STORAGE_KEYS[source]}）：${unread ? "取得未完了" : found.length ? found.length + "件" : "対象データなし"}`);
      for (const e of found) {
        lines.push(`[${e.source}]${e.parentId ? " 親record id: " + e.parentId : ""}`);
        for (const key of FIELDS) lines.push(`${key === "quantity" ? "allocation quantity" : key}: ${formatValue(e.raw[key])}`);
        // Formal cloud/IndexedDB columns are shown without substituting defaults.
        for (const key of ["lot_number", "sync_status", "sync_error", "completed_weight_g", "yield_rate", "recipe_id", "product_id", "recipe_version_id"]) if (Object.hasOwn(e.raw, key)) lines.push(`${key}: ${formatValue(e.raw[key])}`);
      }
    }
    lines.push(`\n判定：${report.decision}`);
    for (const [key, candidates] of Object.entries(report.candidates)) for (const c of candidates) lines.push(`残存：${c.source} ${key}=${c.value}（id: ${formatValue(c.id)}）`);
    if (report.conflicts.length) lines.push(...report.conflicts.map((v) => `競合：${v}`));
    if (report.incomplete.length) lines.push(...report.incomplete.map((v) => `取得失敗：${v}`));
    if (report.ambiguousSaved) lines.push("保存済みレシピ：複数候補のため重量復元には不使用");
    if (report.inference) lines.push(`逆算可能候補：${report.inference.weight}g / ${report.inference.unit}g = ${report.inference.count}（整数との差0.01以内・自動確定なし）`);
    lines.push(`結果：${report.result}`);
    return lines.join("\n");
  }
  global.MeatHistoryDiagnostics = { TARGETS, SOURCES, inspect, text, formatValue };
})(window);
