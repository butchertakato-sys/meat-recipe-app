(function (global) {
  "use strict";
  const WEIGHTS = new Set(["meatTotal", "totalWeight", "recipeTotal", "theoreticalFinishedWeight", "savedUnitWeightG", "unitWeight", "packWeight", "herbStandardUnitWeightG", "herbEventUnitWeightG"]);
  const COUNTS = new Set(["packageCount", "completedCount", "herbStandardPackageCount", "herbEventPieceCount", "smokedCount", "unsmokedCount"]);
  const present = (value) => value != null && value !== "" && !(Array.isArray(value) && !value.length);
  const failed = (record) => record.syncStatus === "error" || record.syncStatus === "pending";
  const complete = (record) => Number(record.meatTotal) > 0 && (Number(record.packageCount) > 0 || Number(record.completedCount) > 0 || Number(record.herbEventPieceCount) > 0 || Number(record.herbStandardPackageCount) > 0);
  const time = (record) => Date.parse(record.updatedAt || record.savedAt || record.createdAt || "") || 0;

  function quantityFields(record) {
    const code = global.MeatProductionSyncAdapter && global.MeatProductionSyncAdapter.internalCode(record);
    if (code === "HERB") return ["herbStandardPackageCount", "herbEventPieceCount"];
    if (code === "GIBIER_CENTER") return ["smokedCount", "unsmokedCount"];
    return [record.packagingUnit === "本" ? "completedCount" : "packageCount"];
  }

  function positiveProduction(record) {
    return ["yieldRate", "actualYieldPercent", "finishedWeight", "actualFinishedWeightG"].some((key) => Number(record[key]) > 0);
  }

  function corruptedZero(record) {
    return quantityFields(record).every((key) => !(Number(record[key]) > 0)) && positiveProduction(record);
  }

  function healthyRecord(record) {
    return record.syncStatus === "synced" && Number(record.meatTotal) > 0 && !corruptedZero(record)
      && quantityFields(record).some((key) => present(record[key]));
  }

  function fromBundle(bundle) {
    const cloud = bundle.record || {};
    const allocations = bundle.allocations || cloud.manufacturing_allocations || [];
    let meta = {};
    try { meta = JSON.parse((allocations.find((a) => a.allocation_type === "LEGACY_META") || {}).notes || "{}"); } catch (_) {}
    const legacy = { ...meta, ...(cloud.legacy_payload || {}) };
    const result = { ...legacy, id: cloud.id, manufacturingRecordId: cloud.id, cloudRecordId: cloud.id,
      lot: cloud.lot_number || legacy.lot, prepDate: cloud.prep_date || legacy.prepDate, date: cloud.manufacturing_date || legacy.date,
      category: legacy.category || (cloud.manufacturing_type === "own" ? "自社レシピ" : "委託製造"),
      recipeName: legacy.recipeName || (cloud.recipe || {}).display_name || (cloud.product || {}).display_name,
      productInternalCode: (cloud.product || {}).internal_code || legacy.productInternalCode,
      recipeInternalCode: (cloud.recipe || {}).internal_code || legacy.recipeInternalCode,
      cloudProductId: cloud.product_id || legacy.cloudProductId, cloudRecipeId: cloud.recipe_id || legacy.cloudRecipeId,
      cloudRecipeVersionId: cloud.recipe_version_id || legacy.cloudRecipeVersionId,
      syncStatus: cloud.sync_status || "synced", syncError: cloud.sync_error || "", status: cloud.status || "active",
      updatedAt: cloud.updated_at || legacy.updatedAt };
    const columns = { theoreticalFinishedWeight: "theoretical_weight_g", finishedWeight: "completed_weight_g", actualFinishedWeightG: "completed_weight_g", yieldRate: "yield_rate", actualYieldPercent: "yield_rate", leftoverWeight: "remainder_weight_g", memo: "memo" };
    for (const [key, column] of Object.entries(columns)) if (present(cloud[column]) && !(failed(result) && Number(cloud[column]) === 0 && Number(legacy[key]) > 0)) result[key] = cloud[column];
    const types = { STANDARD: null, HERB_STANDARD: "herbStandardPackageCount", HERB_EVENT: "herbEventPieceCount", GIBIER_SMOKED: "smokedCount", GIBIER_UNSMOKED: "unsmokedCount", LOSS: "lossCount", TOUGE: "togePieceCount" };
    for (const a of allocations) {
      if (!(a.allocation_type in types)) continue;
      const key = types[a.allocation_type] || (a.quantity_unit === "piece" ? "completedCount" : "packageCount");
      // Allocations are the explicit quantity columns, not a synthesized metadata zero.
      if (!(failed(result) && Number(a.quantity) === 0 && Number(legacy[key]) > 0)) result[key] = a.quantity;
      if (a.allocation_type === "STANDARD") {
        result.packagingUnit = a.quantity_unit === "piece" ? "本" : "パック";
        if (Number(a.unit_weight_g) > 0) result.savedUnitWeightG = a.unit_weight_g;
      }
      if (a.allocation_type === "HERB_STANDARD") result.herbStandardUnitWeightG = a.unit_weight_g;
      if (a.allocation_type === "HERB_EVENT") result.herbEventUnitWeightG = a.unit_weight_g;
      if (a.allocation_type === "TOUGE") Object.assign(result, { togeAllocationEnabled: true, togeAllocationId: a.allocation_code, togeAllocatedWeight: a.calculated_weight_g });
    }
    if (allocations.some((a) => a.allocation_type === "GIBIER_SMOKED" || a.allocation_type === "GIBIER_UNSMOKED")) result.completedCount = Number(result.smokedCount || 0) + Number(result.unsmokedCount || 0);
    const code = global.MeatProductionSyncAdapter && global.MeatProductionSyncAdapter.internalCode(result);
    if (code && code !== "HERB" && code !== "UNKNOWN") {
      delete result.herbStandardPackageCount;
      delete result.herbEventPieceCount;
    }
    return result;
  }

  function canonical(sources) {
    const candidates = sources.filter((s) => s && s.record).map((s, index) => {
      const record = { ...s.record };
      // Keep aliases from the same authoritative source together; an error cache's
      // actualYieldPercent=0 must not override an archive's yieldRate=78.
      for (const [actual, legacy] of [["actualFinishedWeightG", "finishedWeight"], ["actualYieldPercent", "yieldRate"]]) {
        const value = present(record[actual]) && !(Number(record[actual]) === 0 && Number(record[legacy]) > 0) ? record[actual] : record[legacy];
        if (present(value)) { record[actual] = value; record[legacy] = value; }
      }
      if (!present(record.theoreticalFinishedWeight) && Number(record.totalWeight) > 0) record.theoreticalFinishedWeight = record.totalWeight;
      return { ...s, record, index };
    });
    // A later successful edit, including a deliberate zero, must beat an archive.
    const healthy = candidates.filter((s) => healthyRecord(s.record)).sort((a, b) => time(b.record) - time(a.record))[0];
    candidates.sort((a, b) => {
      if (healthy && time(healthy.record) && time(healthy.record) >= Math.max(time(a.record), time(b.record))) {
        if (a === healthy) return -1;
        if (b === healthy) return 1;
      }
      const rank = (s) => failed(s.record) && s.source === "indexed" ? 4 : ({ archive: 0, local: 1, cloud: 2, indexed: 3 }[s.source] ?? 3);
      return rank(a) - rank(b) || time(b.record) - time(a.record) || a.index - b.index;
    });
    const result = {};
    for (const { record } of candidates) for (const [key, value] of Object.entries(record)) {
      if (!present(value)) continue;
      if (!present(result[key]) || (WEIGHTS.has(key) && !(Number(result[key]) > 0) && Number(value) > 0)) result[key] = value;
      // Sparse error defaults and synced zeros contradicting production evidence
      // cannot suppress explicit positive historical quantities.
      else if (COUNTS.has(key) && Number(result[key]) === 0 && Number(value) > 0 && !healthy && ((corruptedZero(candidates[0].record) && quantityFields(candidates[0].record).includes(key)) || (failed(candidates[0].record) && !complete(candidates[0].record)))) result[key] = value;
    }
    const identity = candidates.find((s) => s.source === "cloud") || candidates.find((s) => s.record.cloudRecordId);
    if (identity) {
      const r = identity.record;
      const id = r.cloudRecordId || r.id;
      Object.assign(result, { id, manufacturingRecordId: id, cloudRecordId: id });
      for (const key of ["cloudProductId", "cloudRecipeId", "cloudRecipeVersionId"]) if (present(r[key])) result[key] = r[key];
    }
    const sync = candidates.filter((s) => s.source === "indexed" || s.source === "cloud").sort((a, b) => time(b.record) - time(a.record))[0];
    if (sync) { result.syncStatus = sync.record.syncStatus; result.syncError = sync.record.syncError || ""; if (sync.record.status === "deleted") result.status = "deleted"; }
    return result;
  }

  function restoreSaved(record, savedRecipes) {
    const direct = record.savedRecipeId || record.savedCalculationId;
    const name = (r) => String(r.savedRecipeName || r.recipeName || "").replace(/（.*$/, "").trim();
    const matches = savedRecipes.filter((r) => direct ? [r.id, r.savedRecipeId, r.cloudSavedRecipeId].includes(direct) : r.prepDate === record.prepDate && r.category === record.category && name(r) === name(record));
    const ids = new Set(matches.map((r) => r.savedRecipeId || r.id));
    if (ids.size !== 1 || !matches.length || (matches.length > 1 && matches.some((r) => !r.id && !r.savedRecipeId))) return { ...record };
    const saved = canonical(matches.map((r) => ({ source: "local", record: {
      ...r, recipeRows: r.rows || r.recipeRows, recipeTotal: r.total ?? r.recipeTotal
    } })));
    saved.rows = saved.recipeRows;
    saved.total = saved.recipeTotal;
    const result = { ...record };
    const missingPrep = !(Number(record.meatTotal) > 0);
    const mapping = { meat6mm: "meat6mm", meat3mm: "meat3mm", meatTotal: "meatTotal", waterAmount: "waterAmount", emulsionWeight: "emulsionWeight", recipeRows: "rows", recipeTotal: "total", totalWeight: "totalWeight", theoreticalFinishedWeight: "theoreticalFinishedWeight" };
    for (const [key, field] of Object.entries(mapping)) {
      const value = saved[field] ?? (key === "theoreticalFinishedWeight" ? saved.totalWeight : undefined);
      if ((!present(result[key]) || (typeof value !== "object" && Number(result[key]) === 0 && (missingPrep || WEIGHTS.has(key)))) && present(value)) result[key] = value;
    }
    for (const key of ["prepDate", "category", "recipeName", "savedRecipeName", "recipeCode", "recipeKind"]) {
      if (!present(result[key]) && present(saved[key])) result[key] = saved[key];
    }
    if (!result.savedRecipeId) result.savedRecipeId = saved.savedRecipeId || saved.id;
    return result;
  }

  // Inference is only for absent or logically inconsistent zero quantities; within 0.01 of an integer (1% of one unit).
  function inferCount(record) {
    const result = { ...record };
    const code = global.MeatProductionSyncAdapter && global.MeatProductionSyncAdapter.internalCode(result);
    if (code === "HERB" || code === "GIBIER_CENTER") return result;
    const key = result.packagingUnit === "本" ? "completedCount" : "packageCount";
    if (present(result[key]) && !(Number(result[key]) === 0 && corruptedZero(result))) return result;
    const weight = Number(result.actualFinishedWeightG) > 0 ? Number(result.actualFinishedWeightG) : Number(result.finishedWeight);
    const unit = Number(result.savedUnitWeightG || result.unitWeight || result.packWeight);
    const count = weight / unit;
    if (weight > 0 && unit > 0 && Math.abs(count - Math.round(count)) <= 0.01) result[key] = Math.round(count);
    return result;
  }

  function mergeHistory(sources, savedRecipes = []) {
    const groups = [];
    for (const source of sources) {
      const r = source.record;
      if (!r) continue;
      const id = r.cloudRecordId || r.manufacturingRecordId || r.id;
      let group = groups.find((g) => g.some((s) => (r.lot && s.record.lot === r.lot) || (id && [s.record.cloudRecordId, s.record.manufacturingRecordId, s.record.id].includes(id))));
      if (!group) { group = []; groups.push(group); }
      group.push(source);
    }
    return groups.map((g) => {
      const record = inferCount(restoreSaved(canonical(g), savedRecipes));
      const ids = new Set(g.map((s) => s.record.cloudRecordId || (["cloud", "indexed"].includes(s.source) ? s.record.id : null)).filter(Boolean));
      if (ids.size > 1) record.recoveryConflict = [...ids];
      return record;
    });
  }
  global.MeatHistoryRecovery = { fromBundle, canonical, restoreSaved, inferCount, mergeHistory, corruptedZero, healthyRecord };
})(window);
