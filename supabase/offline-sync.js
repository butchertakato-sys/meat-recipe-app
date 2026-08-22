(function (global) {
  "use strict";

  const DB_NAME = "meat-production-db";
  const DB_VERSION = 1;
  const RECORD_STORE = "manufacturing_records";
  const ALLOCATION_STORE = "manufacturing_allocations";
  const META_STORE = "sync_meta";
  const RETRYABLE = new Set(["pending", "error"]);

  let dbPromise;
  let syncPromise = null;
  let historyPullPromise = null;
  let currentConfig = null;

  function uuid() {
    if (global.crypto && typeof global.crypto.randomUUID === "function") return global.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    global.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function requestPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
    });
  }

  function transactionPromise(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
    });
  }

  function openDatabase() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = global.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(RECORD_STORE)) {
          const records = db.createObjectStore(RECORD_STORE, { keyPath: "id" });
          records.createIndex("lot_number", "lot_number", { unique: false });
          records.createIndex("prep_date", "prep_date", { unique: false });
          records.createIndex("product_id", "product_id", { unique: false });
          records.createIndex("sync_status", "sync_status", { unique: false });
          records.createIndex("updated_at", "updated_at", { unique: false });
        }
        if (!db.objectStoreNames.contains(ALLOCATION_STORE)) {
          const allocations = db.createObjectStore(ALLOCATION_STORE, { keyPath: "id" });
          allocations.createIndex("manufacturing_record_id", "manufacturing_record_id", { unique: false });
          allocations.createIndex("sync_status", "sync_status", { unique: false });
        }
        if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
      request.onblocked = () => reject(new Error("IndexedDB upgrade is blocked"));
    });
    return dbPromise;
  }

  async function putBundle(record, allocations, syncStatus = "pending", syncError = null) {
    const db = await openDatabase();
    const now = new Date().toISOString();
    const normalizedRecord = {
      ...record,
      id: record.id || uuid(),
      status: record.status || "active",
      created_at: record.created_at || now,
      updated_at: record.updated_at || now,
      sync_status: syncStatus,
      last_sync_at: syncStatus === "synced" ? now : (record.last_sync_at || null),
      sync_error: syncError
    };
    const normalizedAllocations = (allocations || []).map((allocation) => ({
      ...allocation,
      id: allocation.id || uuid(),
      manufacturing_record_id: normalizedRecord.id,
      business_id: allocation.business_id || normalizedRecord.business_id,
      created_at: allocation.created_at || now,
      updated_at: allocation.updated_at || now,
      sync_status: syncStatus,
      last_sync_at: syncStatus === "synced" ? now : (allocation.last_sync_at || null),
      sync_error: syncError
    }));

    const transaction = db.transaction([RECORD_STORE, ALLOCATION_STORE], "readwrite");
    const recordStore = transaction.objectStore(RECORD_STORE);
    const allocationStore = transaction.objectStore(ALLOCATION_STORE);
    recordStore.put(normalizedRecord);

    const index = allocationStore.index("manufacturing_record_id");
    const existing = await requestPromise(index.getAll(normalizedRecord.id));
    existing.forEach((item) => allocationStore.delete(item.id));
    normalizedAllocations.forEach((item) => allocationStore.put(item));
    await transactionPromise(transaction);
    await emitPendingCount();
    return { record: normalizedRecord, allocations: normalizedAllocations };
  }

  async function bundleForRecord(record) {
    const db = await openDatabase();
    const transaction = db.transaction([ALLOCATION_STORE], "readonly");
    const allocations = await requestPromise(transaction.objectStore(ALLOCATION_STORE).index("manufacturing_record_id").getAll(record.id));
    return { record, allocations };
  }

  async function setBundleSyncState(recordId, status, errorText = null) {
    const db = await openDatabase();
    const transaction = db.transaction([RECORD_STORE, ALLOCATION_STORE], "readwrite");
    const recordStore = transaction.objectStore(RECORD_STORE);
    const allocationStore = transaction.objectStore(ALLOCATION_STORE);
    const record = await requestPromise(recordStore.get(recordId));
    if (!record) throw new Error("Local manufacturing record not found");
    const now = new Date().toISOString();
    record.sync_status = status;
    record.sync_error = errorText;
    if (status === "synced") record.last_sync_at = now;
    recordStore.put(record);
    const allocations = await requestPromise(allocationStore.index("manufacturing_record_id").getAll(recordId));
    allocations.forEach((allocation) => {
      allocation.sync_status = status;
      allocation.sync_error = errorText;
      if (status === "synced") allocation.last_sync_at = now;
      allocationStore.put(allocation);
    });
    await transactionPromise(transaction);
    await emitPendingCount();
  }

  function cloudConfigured() {
    return Boolean(currentConfig && currentConfig.url && currentConfig.publishableKey && currentConfig.enabled !== false);
  }

  async function accessToken() {
    if (!currentConfig) return "";
    if (typeof currentConfig.getAccessToken === "function") return await currentConfig.getAccessToken();
    return currentConfig.accessToken || "";
  }

  async function setMeta(key, value) {
    const db = await openDatabase();
    const transaction = db.transaction(META_STORE, "readwrite");
    transaction.objectStore(META_STORE).put({ key, value, updated_at: new Date().toISOString() });
    await transactionPromise(transaction);
  }

  async function getMeta(key) {
    const db = await openDatabase();
    const result = await requestPromise(db.transaction(META_STORE, "readonly").objectStore(META_STORE).get(key));
    return result ? result.value : null;
  }

  function cloudRecord(record) {
    const { sync_status, last_sync_at, sync_error, ...payload } = record;
    return payload;
  }

  function cloudAllocation(allocation) {
    const { sync_status, last_sync_at, sync_error, ...payload } = allocation;
    return payload;
  }

  async function sendBundle(bundle) {
    if (!cloudConfigured()) throw new Error("Supabase connection is not configured");
    const token = await accessToken();
    if (!token) throw new Error("Supabase authentication session is not available");
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    let response;
    try {
      response = await fetch(`${currentConfig.url.replace(/\/$/, "")}/rest/v1/rpc/save_manufacturing_record`, {
        method: "POST",
        headers: {
          apikey: currentConfig.publishableKey,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          record_data: cloudRecord(bundle.record),
          allocation_data: bundle.allocations.map(cloudAllocation)
        }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Supabase ${response.status}: ${detail.slice(0, 500)}`);
    }
    return response;
  }

  async function fetchCloudHistory() {
    if (!cloudConfigured()) throw new Error("Supabase connection is not configured");
    const token = await accessToken();
    if (!token) throw new Error("Supabase authentication session is not available");
    const select = "*,product:products(display_name,internal_code),recipe:recipes(display_name,internal_code),manufacturing_allocations(*)";
    const params = new URLSearchParams({ select, order: "updated_at.asc" });
    if (currentConfig.businessId) params.set("business_id", `eq.${currentConfig.businessId}`);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    let response;
    try {
      response = await fetch(`${currentConfig.url.replace(/\/$/, "")}/rest/v1/manufacturing_records?${params.toString()}`, {
        headers: {
          apikey: currentConfig.publishableKey,
          Authorization: `Bearer ${token}`
        },
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Supabase ${response.status}: ${detail.slice(0, 500)}`);
    }
    return await response.json();
  }

  async function cacheCloudHistory(cloudRows) {
    const db = await openDatabase();
    const existingRecords = await requestPromise(db.transaction(RECORD_STORE, "readonly").objectStore(RECORD_STORE).getAll());
    const existingById = new Map(existingRecords.map((record) => [record.id, record]));
    const now = new Date().toISOString();
    const accepted = [];
    for (const row of cloudRows || []) {
      const existing = existingById.get(row.id);
      if (existing && RETRYABLE.has(existing.sync_status)) continue;
      if (existing && existing.sync_status === "syncing") continue;
      if (existing && Date.parse(existing.updated_at || 0) > Date.parse(row.updated_at || 0)) continue;
      accepted.push(row);
    }
    const transaction = db.transaction([RECORD_STORE, ALLOCATION_STORE], "readwrite");
    const recordStore = transaction.objectStore(RECORD_STORE);
    const allocationStore = transaction.objectStore(ALLOCATION_STORE);
    for (const row of accepted) {
      const allocations = Array.isArray(row.manufacturing_allocations) ? row.manufacturing_allocations : [];
      const record = { ...row };
      delete record.manufacturing_allocations;
      recordStore.put({ ...record, sync_status: "synced", last_sync_at: now, sync_error: null });
      const oldAllocations = await requestPromise(allocationStore.index("manufacturing_record_id").getAll(row.id));
      oldAllocations.forEach((allocation) => allocationStore.delete(allocation.id));
      allocations.forEach((allocation) => allocationStore.put({
        ...allocation,
        sync_status: "synced",
        last_sync_at: now,
        sync_error: null
      }));
    }
    await transactionPromise(transaction);
    return accepted.length;
  }

  async function pullHistoryFromCloud() {
    if (historyPullPromise) return historyPullPromise;
    historyPullPromise = (async () => {
      try {
        const rows = await fetchCloudHistory();
        const updatedCount = await cacheCloudHistory(rows);
        const syncedAt = new Date().toISOString();
        await setMeta("last_history_sync_at", syncedAt);
        await setMeta("last_history_sync_result", "success");
        await setMeta("last_history_sync_error", null);
        global.dispatchEvent(new CustomEvent("meat-production-history-cache", { detail: { success: true, syncedAt, updatedCount } }));
        return { success: true, syncedAt, updatedCount };
      } catch (error) {
        await setMeta("last_history_sync_result", "error");
        await setMeta("last_history_sync_error", String(error && error.message ? error.message : error));
        global.dispatchEvent(new CustomEvent("meat-production-history-cache", { detail: { success: false } }));
        throw error;
      }
    })();
    try {
      return await historyPullPromise;
    } finally {
      historyPullPromise = null;
    }
  }

  async function refreshHistoryCache() {
    await syncPending();
    return await pullHistoryFromCloud();
  }

  async function syncBundle(bundle) {
    await setBundleSyncState(bundle.record.id, "syncing");
    try {
      const fresh = await bundleForRecord({ ...bundle.record, sync_status: "syncing" });
      await sendBundle(fresh);
      await setBundleSyncState(bundle.record.id, "synced");
      return { synced: true, recordId: bundle.record.id };
    } catch (error) {
      await setBundleSyncState(bundle.record.id, "error", String(error && error.message ? error.message : error));
      return { synced: false, recordId: bundle.record.id, error };
    }
  }

  async function saveAndSync(record, allocations) {
    const local = await putBundle(record, allocations, "pending");
    const cloud = await syncBundle(local);
    if (cloud.synced) setTimeout(() => pullHistoryFromCloud().catch(() => {}), 0);
    return { localSaved: true, ...cloud, record: local.record, allocations: local.allocations };
  }

  async function pendingRecords() {
    const db = await openDatabase();
    const transaction = db.transaction(RECORD_STORE, "readonly");
    const records = await requestPromise(transaction.objectStore(RECORD_STORE).getAll());
    return records.filter((record) => RETRYABLE.has(record.sync_status));
  }

  async function syncPending() {
    if (syncPromise) return syncPromise;
    syncPromise = (async () => {
      const records = await pendingRecords();
      const results = [];
      for (const record of records) results.push(await syncBundle(await bundleForRecord(record)));
      return results;
    })();
    try {
      return await syncPromise;
    } finally {
      syncPromise = null;
    }
  }

  async function markDeleted(recordId) {
    const db = await openDatabase();
    const transaction = db.transaction(RECORD_STORE, "readonly");
    const record = await requestPromise(transaction.objectStore(RECORD_STORE).get(recordId));
    if (!record) throw new Error("Local manufacturing record not found");
    const bundle = await bundleForRecord(record);
    bundle.record.status = "deleted";
    bundle.record.updated_at = new Date().toISOString();
    return saveAndSync(bundle.record, bundle.allocations);
  }

  async function getLocalRecords(options = {}) {
    const db = await openDatabase();
    const records = await requestPromise(db.transaction(RECORD_STORE, "readonly").objectStore(RECORD_STORE).getAll());
    return options.includeDeleted ? records : records.filter((record) => record.status !== "deleted");
  }

  async function getLocalHistory() {
    const records = await getLocalRecords({ includeDeleted: true });
    const bundles = [];
    for (const record of records) bundles.push(await bundleForRecord(record));
    return bundles;
  }

  async function pendingCount() {
    return (await pendingRecords()).length;
  }

  async function emitPendingCount() {
    const count = await pendingCount();
    global.dispatchEvent(new CustomEvent("meat-production-sync-status", { detail: { pendingCount: count } }));
    return count;
  }

  async function initialize(config) {
    currentConfig = config || {};
    await openDatabase();
    global.addEventListener("online", () => refreshHistoryCache().catch(() => {}));
    await emitPendingCount();
    if (global.navigator.onLine) syncPending().catch(() => {});
    return { pendingCount: await pendingCount(), cloudConfigured: cloudConfigured() };
  }

  global.MeatProductionSync = {
    initialize,
    uuid,
    saveAndSync,
    syncPending,
    markDeleted,
    getLocalRecords,
    getLocalHistory,
    pullHistoryFromCloud,
    refreshHistoryCache,
    getMeta,
    pendingCount,
    putBundle
  };
})(window);
