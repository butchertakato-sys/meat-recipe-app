(function (global) {
  "use strict";

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  const CODE_ALIASES = Object.freeze({
    ARA: "ARABIKI",
    ARABIKI: "ARABIKI",
    "OWN:ARABIKI": "ARABIKI",
    PROD_ARABIKI: "ARABIKI",
    "ADDITIVE-FREE-ARABIKI": "ADDITIVE_FREE_ARABIKI",
    ADDITIVE_FREE: "ADDITIVE_FREE_ARABIKI",
    ADDITIVE_FREE_ARABIKI: "ADDITIVE_FREE_ARABIKI",
    "OWN:ADDITIVEFREEARABIKI": "ADDITIVE_FREE_ARABIKI",
    PROD_ADDITIVE_FREE_ARABIKI: "ADDITIVE_FREE_ARABIKI",
    HERB: "HERB",
    "HERB-P": "HERB",
    "HERB-E": "HERB",
    "OWN:HERB": "HERB",
    "OWN:HERBPRODUCT": "HERB",
    "OWN:HERBEVENT": "HERB",
    PROD_HERB: "HERB",
    CHEESE: "CHEESE",
    "OWN:CHEESE": "CHEESE",
    PROD_CHEESE: "CHEESE",
    CHORIZO: "CHORIZO",
    "OWN:CHORIZO": "CHORIZO",
    PROD_CHORIZO: "CHORIZO",
    YAMAGOYA: "YAMAGOYA",
    PROD_YAMAGOYA: "YAMAGOYA",
    GIBIER: "GIBIER_CENTER",
    GIBIER_DEER: "GIBIER_CENTER",
    GIBIER_CENTER: "GIBIER_CENTER",
    PROD_GIBIER_CENTER: "GIBIER_CENTER",
    TOUGE: "TOUGE",
    PROD_TOGE_CHAYA: "TOUGE",
    ZANZATEI_DEER: "ZANZATEI",
    ZANZATEI: "ZANZATEI",
    PROD_ZANZATEI: "ZANZATEI"
  });

  const CONFIG_CODE_FALLBACKS = Object.freeze({
    ARABIKI: ["ARA"],
    ADDITIVE_FREE_ARABIKI: ["ADDITIVE_FREE"],
    GIBIER_CENTER: ["GIBIER_DEER"],
    ZANZATEI: ["ZANZATEI_DEER"]
  });

  function internalCode(record) {
    const legacyCode = record.recipeCode || record.productCode || record.recipeId || record.productId || "";
    const code = String(legacyCode).toUpperCase();
    return CODE_ALIASES[code] || code || "UNKNOWN";
  }

  function idFor(group, code, config) {
    const ids = config && config.ids && config.ids[group];
    if (!ids) return null;
    if (ids[code]) return ids[code];
    const fallback = (CONFIG_CODE_FALLBACKS[code] || []).find((alias) => ids[alias]);
    return fallback ? ids[fallback] : null;
  }

  function allocation(recordId, businessId, values, syncApi) {
    const now = new Date().toISOString();
    return {
      id: syncApi.uuid(),
      manufacturing_record_id: recordId,
      business_id: businessId || null,
      packaging_master_id: values.packaging_master_id || null,
      packaging_version_id: values.packaging_version_id || null,
      quantity: number(values.quantity),
      quantity_unit: values.quantity_unit,
      unit_weight_g: number(values.unit_weight_g),
      calculated_weight_g: number(values.calculated_weight_g),
      count_as_completed_weight: values.count_as_completed_weight !== false,
      count_as_loss: Boolean(values.count_as_loss),
      allocation_type: values.allocation_type,
      allocation_code: values.allocation_code || null,
      notes: values.notes || null,
      created_at: now,
      updated_at: now
    };
  }

  function allocationsFromLegacy(record, recordId, code, config, syncApi) {
    const businessId = config.businessId || null;
    const result = [];
    const add = (type, quantity, quantityUnit, unitWeight, completed = true, loss = false, packagingCode = type) => {
      const safeQuantity = number(quantity);
      if (safeQuantity <= 0 && type !== "LOSS") return;
      result.push(allocation(recordId, businessId, {
        allocation_type: type,
        packaging_master_id: idFor("packagingMasters", packagingCode, config),
        packaging_version_id: idFor("packagingVersions", packagingCode, config),
        quantity: safeQuantity,
        quantity_unit: quantityUnit,
        unit_weight_g: unitWeight,
        calculated_weight_g: safeQuantity * number(unitWeight),
        count_as_completed_weight: completed,
        count_as_loss: loss,
        allocation_code: type === "TOUGE" ? (record.togeAllocationId || null) : null
      }, syncApi));
    };

    const isCombinedHerb = code === "HERB" && (record.herbStandardPackageCount != null || record.herbEventPieceCount != null);
    const isGibier = code === "GIBIER_CENTER";
    if (isCombinedHerb) {
      add("HERB_STANDARD", record.herbStandardPackageCount, "package", record.herbStandardUnitWeightG, true, false, "HERB_STANDARD");
      add("HERB_EVENT", record.herbEventPieceCount, "piece", record.herbEventUnitWeightG, true, false, "HERB_EVENT");
    } else if (isGibier) {
      const unitWeight = number(record.savedUnitWeightG || record.unitWeight || record.packWeight);
      add("GIBIER_SMOKED", record.smokedCount, "piece", unitWeight, true, false, "GIBIER_CENTER_STANDARD");
      add("GIBIER_UNSMOKED", record.unsmokedCount, "piece", unitWeight, true, false, "GIBIER_CENTER_STANDARD");
    } else {
      const packagingUnit = record.packagingUnit === "本" ? "piece" : "package";
      const quantity = packagingUnit === "piece" ? record.completedCount : record.packageCount;
      add("STANDARD", quantity, packagingUnit, record.savedUnitWeightG || record.unitWeight || record.packWeight, true, false, `${code}_STANDARD`);
    }

    if (record.togeAllocationEnabled) add("TOUGE", record.togePieceCount, "piece", 35, true, false, "TOUGE_STANDARD");
    const lossCount = number(record.lossCount);
    if (lossCount > 0) add("LOSS", lossCount, "piece", 0, false, true, `${code}_STANDARD`);
    return result;
  }

  function fromLegacy(record, config, syncApi) {
    const code = internalCode(record);
    const now = new Date().toISOString();
    const recordId = record.cloudRecordId || (String(record.id || "").match(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i) ? record.id : syncApi.uuid());
    const cloudRecord = {
      id: recordId,
      business_id: config.businessId || null,
      product_id: idFor("products", code, config),
      recipe_id: idFor("recipes", code, config),
      recipe_version_id: idFor("recipeVersions", code, config),
      prep_date: record.prepDate || null,
      manufacturing_date: record.date || null,
      lot_number: record.lot || "",
      manufacturing_type: record.category === "自社レシピ" ? "own" : "contract",
      theoretical_weight_g: number(record.theoreticalFinishedWeight),
      completed_weight_g: number(record.actualFinishedWeightG != null ? record.actualFinishedWeightG : record.finishedWeight),
      yield_rate: record.actualYieldPercent != null ? number(record.actualYieldPercent) : (record.yieldRate == null ? null : number(record.yieldRate)),
      loss_weight_g: number(record.lossWeightG),
      remainder_weight_g: number(record.leftoverWeight),
      memo: record.memo || "",
      status: record.status === "deleted" ? "deleted" : "active",
      created_at: record.createdAt || record.savedAt || now,
      updated_at: record.updatedAt || now,
      legacy_payload: record
    };
    return {
      record: cloudRecord,
      allocations: allocationsFromLegacy(record, recordId, code, config, syncApi),
      legacyRecordPatch: { id: recordId, manufacturingRecordId: recordId, cloudRecordId: recordId }
    };
  }

  global.MeatProductionSyncAdapter = { fromLegacy, internalCode, CODE_ALIASES };
})(window);
