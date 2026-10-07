(function (global) {
  "use strict";

  const SAVED_KEY = "savedRecipes";
  const OLD_SAVED_KEY = "meatRecipeApp.savedRecipeCalculations.v1";
  const DEVICE_KEY = "meatRecipeApp.deviceId.v1";
  const STATUS_KEY = "meatRecipeApp.crossDeviceSyncStatus.v1";
  const DELETED_SAVED_QUEUE_KEY = "meatRecipeApp.deletedSavedRecipes.v1";

  let currentConfig = null;

  function nowIso() { return new Date().toISOString(); }

  function uuid() {
    if (global.crypto && typeof global.crypto.randomUUID === "function") return global.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    global.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function deviceId() {
    let id = "";
    try { id = global.localStorage.getItem(DEVICE_KEY) || ""; } catch (_) {}
    if (!id) {
      id = uuid();
      try { global.localStorage.setItem(DEVICE_KEY, id); } catch (_) {}
    }
    return id;
  }

  function readArray(primary, legacy) {
    for (const key of [primary, legacy]) {
      try {
        const value = JSON.parse(global.localStorage.getItem(key) || "null");
        if (Array.isArray(value)) return value;
      } catch (_) {}
    }
    return [];
  }

  function writeArray(key, records) {
    global.localStorage.setItem(key, JSON.stringify(records || []));
  }

  function setStatus(patch) {
    const previous = getStatus();
    const status = { ...previous, ...patch, updatedAt: nowIso() };
    try { global.localStorage.setItem(STATUS_KEY, JSON.stringify(status)); } catch (_) {}
    global.dispatchEvent(new CustomEvent("meat-cross-device-sync-status", { detail: status }));
    return status;
  }

  function getStatus() {
    try { return JSON.parse(global.localStorage.getItem(STATUS_KEY) || "{}") || {}; }
    catch (_) { return {}; }
  }

  async function accessToken() {
    if (!currentConfig) return "";
    if (typeof currentConfig.getAccessToken === "function") return await currentConfig.getAccessToken();
    return currentConfig.accessToken || "";
  }

  async function request(path, options = {}) {
    if (!currentConfig || !currentConfig.url || !currentConfig.publishableKey) {
      throw new Error("Supabase connection is not configured");
    }
    const token = await accessToken();
    if (!token) throw new Error("Supabase authentication session is not available");
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${currentConfig.url.replace(/\/$/, "")}/rest/v1/${path}`, {
        ...options,
        headers: {
          apikey: currentConfig.publishableKey,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...(options.headers || {})
        },
        signal: controller.signal
      });
      if (!response.ok) {
        const detail = await response.text();
        const error = new Error(`Supabase ${response.status}: ${detail.slice(0, 500)}`);
        error.status = response.status;
        throw error;
      }
      if (response.status === 204) return null;
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function schemaReady() {
    try {
      await request("saved_recipe_calculations?select=id&limit=1", { method: "GET" });
      return true;
    } catch (error) {
      if (error && (error.status === 404 || error.status === 400)) return false;
      throw error;
    }
  }

  function localSavedRecipes() { return readArray(SAVED_KEY, OLD_SAVED_KEY); }

  function normalizeSavedRecipeForCloud(record) {
    const rowId = record.cloudSavedRecipeId || uuid();
    const createdAt = record.createdAt || record.savedAt || nowIso();
    const updatedAt = record.updatedAt || createdAt;
    const payload = {
      ...record,
      cloudSavedRecipeId: rowId,
      cloudSyncStatus: "synced",
      cloudSyncError: ""
    };
    return {
      id: rowId,
      business_id: currentConfig.businessId,
      source_device_id: record.sourceDeviceId || deviceId(),
      prep_date: record.prepDate || null,
      category: record.category || "",
      recipe_name: record.recipeName || record.savedRecipeName || "",
      payload,
      status: record.cloudDeleted ? "deleted" : "active",
      created_at: createdAt,
      updated_at: updatedAt
    };
  }

  function cloudSavedRecipeToLocal(row) {
    const payload = row && row.payload && typeof row.payload === "object" ? row.payload : {};
    const id = payload.id || payload.savedRecipeId || row.id;
    return {
      ...payload,
      id,
      savedRecipeId: payload.savedRecipeId || id,
      cloudSavedRecipeId: row.id,
      cloudSyncStatus: "synced",
      cloudSyncError: "",
      sourceDeviceId: row.source_device_id || payload.sourceDeviceId || "",
      createdAt: payload.createdAt || row.created_at,
      updatedAt: payload.updatedAt || row.updated_at,
      cloudDeleted: row.status === "deleted"
    };
  }

  function parseTime(value) {
    const time = Date.parse(value || "");
    return Number.isFinite(time) ? time : 0;
  }

  async function fetchCloudSavedRecipes() {
    const params = new URLSearchParams({
      select: "*",
      business_id: `eq.${currentConfig.businessId}`,
      order: "updated_at.asc"
    });
    return await request(`saved_recipe_calculations?${params.toString()}`, { method: "GET" }) || [];
  }

  async function upsertSavedRecipe(row) {
    const result = await request("saved_recipe_calculations?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(row)
    });
    return Array.isArray(result) ? result[0] : result;
  }

  function readDeletedSavedQueue() {
    try {
      const value = JSON.parse(global.localStorage.getItem(DELETED_SAVED_QUEUE_KEY) || "[]");
      return Array.isArray(value) ? value : [];
    } catch (_) {
      return [];
    }
  }

  function writeDeletedSavedQueue(rows) {
    try { global.localStorage.setItem(DELETED_SAVED_QUEUE_KEY, JSON.stringify(rows || [])); } catch (_) {}
  }

  async function flushDeletedSavedQueue() {
    const queue = readDeletedSavedQueue();
    if (!queue.length) return { attempted: 0, remaining: 0 };
    const remaining = [];
    for (const row of queue) {
      try { await upsertSavedRecipe(row); }
      catch (_) { remaining.push(row); }
    }
    writeDeletedSavedQueue(remaining);
    return { attempted: queue.length, remaining: remaining.length };
  }

  async function syncSavedRecipes() {
    await flushDeletedSavedQueue();
    const local = localSavedRecipes();
    const cloudRows = await fetchCloudSavedRecipes();
    const cloudById = new Map(cloudRows.map((row) => [row.id, row]));
    const merged = [];
    let uploaded = 0;
    let downloaded = 0;

    for (const original of local) {
      let record = { ...original };
      if (!record.cloudSavedRecipeId) {
        record.cloudSavedRecipeId = uuid();
        record.sourceDeviceId = record.sourceDeviceId || deviceId();
        record.cloudSyncStatus = "pending";
        record.updatedAt = record.updatedAt || record.createdAt || record.savedAt || nowIso();
      }
      const cloud = cloudById.get(record.cloudSavedRecipeId);
      if (cloud && cloud.status === "deleted" && parseTime(cloud.updated_at) >= parseTime(record.updatedAt)) {
        cloudById.delete(cloud.id);
        continue;
      }
      if (cloud && parseTime(cloud.updated_at) > parseTime(record.updatedAt)) {
        merged.push(cloudSavedRecipeToLocal(cloud));
        cloudById.delete(cloud.id);
        downloaded += 1;
        continue;
      }
      const row = normalizeSavedRecipeForCloud(record);
      try {
        const saved = await upsertSavedRecipe(row);
        merged.push(cloudSavedRecipeToLocal(saved || row));
        uploaded += 1;
      } catch (error) {
        merged.push({
          ...record,
          cloudSyncStatus: "error",
          cloudSyncError: String(error && error.message ? error.message : error)
        });
      }
      cloudById.delete(record.cloudSavedRecipeId);
    }

    for (const row of cloudById.values()) {
      if (row.status === "deleted") continue;
      merged.push(cloudSavedRecipeToLocal(row));
      downloaded += 1;
    }

    merged.sort((a, b) => String(b.prepDate || "").localeCompare(String(a.prepDate || "")) || parseTime(b.updatedAt) - parseTime(a.updatedAt));
    writeArray(SAVED_KEY, merged);
    return { total: merged.length, uploaded, downloaded };
  }

  async function markSavedRecipeDeleted(record) {
    if (!record) return { synced: false };
    const row = normalizeSavedRecipeForCloud({ ...record, cloudDeleted: true, updatedAt: nowIso() });
    row.status = "deleted";
    try {
      await upsertSavedRecipe(row);
      return { synced: true };
    } catch (error) {
      const queue = readDeletedSavedQueue().filter((item) => item.id !== row.id);
      queue.push(row);
      writeDeletedSavedQueue(queue);
      return { synced: false, queued: true, error };
    }
  }

  async function reserveManufacturingLot(recordId, lotNumber) {
    const raw = String(lotNumber || "").trim();
    const match = raw.match(/^(.*)-([0-9]+)$/);
    const lotBase = match ? match[1] : raw;
    if (!lotBase || !recordId) return raw;
    try {
      const result = await request("rpc/reserve_manufacturing_lot", {
        method: "POST",
        body: JSON.stringify({
          target_business_id: currentConfig.businessId,
          target_lot_base: lotBase,
          target_record_id: recordId
        })
      });
      return typeof result === "string" ? result : raw;
    } catch (error) {
      console.warn("[端末統合] LOT予約に失敗したため端末採番を使用します。", error);
      return raw;
    }
  }

  async function fetchCloudManufacturingRecords() {
    const select = "*,product:products(display_name,internal_code),recipe:recipes(display_name,internal_code),manufacturing_allocations(*)";
    const params = new URLSearchParams({
      select,
      business_id: `eq.${currentConfig.businessId}`,
      order: "updated_at.asc"
    });
    return await request(`manufacturing_records?${params.toString()}`, { method: "GET" }) || [];
  }

  function n(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function sameNumber(a, b, tolerance = 0.01) {
    return Math.abs(n(a) - n(b)) <= tolerance;
  }

  function manufacturingEquivalent(local, cloud) {
    const legacy = cloud && cloud.legacy_payload && typeof cloud.legacy_payload === "object" ? cloud.legacy_payload : {};
    const checks = [
      String(local.prepDate || "") === String(cloud.prep_date || legacy.prepDate || ""),
      String(local.date || "") === String(cloud.manufacturing_date || legacy.date || ""),
      String(local.lot || "") === String(cloud.lot_number || legacy.lot || ""),
      sameNumber(local.theoreticalFinishedWeight || local.totalWeight, cloud.theoretical_weight_g != null ? cloud.theoretical_weight_g : (legacy.theoreticalFinishedWeight || legacy.totalWeight)),
      sameNumber(local.actualFinishedWeightG != null ? local.actualFinishedWeightG : local.finishedWeight, cloud.completed_weight_g != null ? cloud.completed_weight_g : (legacy.actualFinishedWeightG != null ? legacy.actualFinishedWeightG : legacy.finishedWeight)),
      sameNumber(local.leftoverWeight, cloud.remainder_weight_g != null ? cloud.remainder_weight_g : legacy.leftoverWeight)
    ];
    const localRecipe = String(local.recipeName || local.product || local.savedRecipeName || "");
    const cloudRecipe = String((cloud.recipe && cloud.recipe.display_name) || legacy.recipeName || legacy.product || legacy.savedRecipeName || "");
    if (localRecipe && cloudRecipe) checks.push(localRecipe === cloudRecipe);
    return checks.every(Boolean);
  }

  function cloudLotMap(rows) {
    const map = new Map();
    for (const row of rows || []) {
      const lot = String(row.lot_number || "").trim();
      if (!lot || row.status === "deleted") continue;
      if (!map.has(lot)) map.set(lot, []);
      map.get(lot).push(row);
    }
    return map;
  }

  async function migrateManufacturingRecords(options) {
    const loadLocal = options && options.loadLocal;
    const saveLocal = options && options.saveLocal;
    const uploadLocal = options && options.uploadLocal;
    if (typeof loadLocal !== "function" || typeof saveLocal !== "function" || typeof uploadLocal !== "function") {
      throw new Error("Manufacturing migration callbacks are missing");
    }

    const loaded = await loadLocal();
    const local = (Array.isArray(loaded) ? loaded : []).map((row) => ({ ...row }));
    const cloud = await fetchCloudManufacturingRecords();
    const byLot = cloudLotMap(cloud);
    const conflicts = [];
    let uploaded = 0;
    let merged = 0;

    for (let index = 0; index < local.length; index += 1) {
      const record = local[index];
      const lot = String(record.lot || "").trim();
      if (!lot) {
        conflicts.push({ type: "LOT_MISSING", lot: "", recipeName: record.recipeName || record.product || "", date: record.date || record.prepDate || "" });
        continue;
      }

      if (record.cloudRecordId && cloud.some((row) => row.id === record.cloudRecordId)) continue;

      const matches = byLot.get(lot) || [];
      if (matches.length) {
        const equivalent = matches.find((row) => manufacturingEquivalent(record, row));
        if (equivalent) {
          local[index] = {
            ...record,
            id: equivalent.id,
            manufacturingRecordId: equivalent.id,
            cloudRecordId: equivalent.id,
            syncStatus: "synced",
            syncError: ""
          };
          merged += 1;
          continue;
        }
        conflicts.push({
          type: "LOT_CONFLICT",
          lot,
          recipeName: record.recipeName || record.product || "",
          date: record.date || record.prepDate || "",
          cloudRecordIds: matches.map((row) => row.id)
        });
        continue;
      }

      const result = await uploadLocal(record, { migration: true, preserveLot: true });
      if (result && result.synced) {
        uploaded += 1;
        const updatedCloud = await fetchCloudManufacturingRecords();
        const current = updatedCloud.find((row) => row.lot_number === lot);
        local[index] = {
          ...record,
          id: current ? current.id : (result.recordId || record.id),
          manufacturingRecordId: current ? current.id : (result.recordId || record.manufacturingRecordId),
          cloudRecordId: current ? current.id : (result.recordId || record.cloudRecordId),
          syncStatus: "synced",
          syncError: ""
        };
        if (current) byLot.set(lot, [current]);
      } else {
        local[index] = {
          ...record,
          syncStatus: "error",
          syncError: result && result.error ? String(result.error.message || result.error) : "クラウド同期に失敗しました"
        };
      }
    }

    saveLocal(local);
    return { total: local.length, uploaded, merged, conflicts, cloudCount: cloud.length };
  }

  async function syncAll(options = {}) {
    currentConfig = options.config || currentConfig || {};
    setStatus({ state: "running", error: "", conflicts: [] });
    try {
      let savedRecipes = null;
      let savedRecipeSchemaReady = false;
      try {
        savedRecipeSchemaReady = await schemaReady();
        if (savedRecipeSchemaReady) savedRecipes = await syncSavedRecipes();
      } catch (error) {
        savedRecipes = { error: String(error && error.message ? error.message : error) };
      }

      let manufacturing = null;
      if (options.manufacturing) manufacturing = await migrateManufacturingRecords(options.manufacturing);

      const conflicts = manufacturing ? manufacturing.conflicts : [];
      const state = conflicts.length
        ? "conflict"
        : (savedRecipeSchemaReady ? "synced" : "partial");

      return setStatus({
        state,
        error: savedRecipeSchemaReady ? "" : "保存済みレシピ用のSupabaseテーブルが未適用です。製造記録の統合は継続します。",
        conflicts,
        savedRecipes,
        savedRecipeSchemaReady,
        manufacturing
      });
    } catch (error) {
      return setStatus({ state: "error", error: String(error && error.message ? error.message : error) });
    }
  }

  function initialize(config) {
    currentConfig = config || {};
    return { deviceId: deviceId(), status: getStatus() };
  }

  global.MeatCrossDeviceSync = {
    initialize,
    syncAll,
    syncSavedRecipes,
    markSavedRecipeDeleted,
    fetchCloudManufacturingRecords,
    reserveManufacturingLot,
    getStatus,
    statusKey: STATUS_KEY
  };
})(window);
