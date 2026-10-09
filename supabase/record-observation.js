/* Temporary read-only observation. Never calls application loaders, sync or repair. */
(function (global) {
  "use strict";
  const LOTS = ["20260728-IT-GIBIER-01", "20260728-IT-GIBIER-02"];
  const DAY = "2026-07-28";
  const KEYS = ["manufacturingRecords", "meatRecipeApp.manufacturingRecords.v1", "savedRecipes",
    "meatRecipeApp.savedRecipeCalculations.v1", "packagingMaster.v1", "meatRecipeApp.supabaseMasters.v1",
    "meatRecipeApp.deviceId.v1", "meatRecipeApp.crossDeviceSyncStatus.v1"];
  const FIELDS = ["id", "manufacturingRecordId", "cloudRecordId", "savedRecipeId", "savedCalculationId",
    "lot", "lot_number", "prepDate", "prep_date", "date", "manufacturing_date", "createdAt", "created_at",
    "updatedAt", "updated_at", "savedAt", "status", "syncStatus", "sync_status", "syncError", "sync_error",
    "recipeName", "recipeCode", "internal_code", "recipeInternalCode", "productInternalCode",
    "smokedCount", "unsmokedCount", "completedCount", "savedUnitWeightG", "unitWeight", "packWeight",
    "actualFinishedWeightG", "finishedWeight", "theoreticalFinishedWeight", "actualYieldPercent", "yieldRate",
    "completed_weight_g", "theoretical_weight_g", "yield_rate", "sourceDeviceId", "source_device_id", "created_by"];
  const ALLOCATION_FIELDS = ["id", "manufacturing_record_id", "allocation_type", "quantity", "quantity_unit",
    "unit_weight_g", "calculated_weight_g", "packaging_master_id", "packaging_version_id", "created_at", "updated_at", "notes"];

  function value(raw, present = true) {
    if (!present) return { type: "missing" };
    if (raw === undefined) return { type: "undefined" };
    if (raw === null) return { type: "null", value: null };
    return { type: typeof raw === "string" && raw === "" ? "empty-string" : typeof raw, value: raw };
  }
  function fields(row, names) {
    return Object.fromEntries(names.map(key => [key, value(row[key], Object.prototype.hasOwnProperty.call(row, key))]));
  }
  function localSnapshot() {
    return Object.fromEntries(KEYS.map(key => {
      try {
        const raw = global.localStorage.getItem(key);
        if (raw === null) return [key, { state: "missing", raw: null }];
        try { return [key, { state: "present", raw, parsed: JSON.parse(raw) }]; }
        catch (_) { return [key, { state: "invalid-json-or-plain-string", raw }]; }
      } catch (_) { return [key, { state: "unavailable" }]; }
    }));
  }
  const array = entry => Array.isArray(entry && entry.parsed) ? entry.parsed : [];
  const lot = row => row.lot_number ?? row.lot;
  function relevant(row) {
    return LOTS.includes(lot(row)) || ((row.manufacturing_date ?? row.date) === DAY &&
      global.MeatProductionSyncAdapter.internalCode({ ...row, recipeInternalCode: row.recipe?.internal_code || row.recipeInternalCode,
        productInternalCode: row.product?.internal_code || row.productInternalCode }) === "GIBIER_CENTER");
  }
  function decodeMeta(allocations) {
    return allocations.filter(a => a.allocation_type === "LEGACY_META").map(a => {
      try {
        const parsed = JSON.parse(a.notes);
        return { allocationId: a.id, notes: value(a.notes), parsed,
          fields: parsed && typeof parsed === "object" ? fields(parsed, FIELDS) : null };
      } catch (_) { return { allocationId: a.id, notes: value(a.notes), error: "LEGACY_META JSON parse failed" }; }
    });
  }
  function observeRow(row, allocations = []) {
    return { fields: fields(row, FIELDS), raw: row,
      legacyPayload: row.legacy_payload && typeof row.legacy_payload === "object" ? fields(row.legacy_payload, FIELDS) : value(row.legacy_payload),
      allocations: allocations.map(a => ({ fields: fields(a, ALLOCATION_FIELDS), raw: a })),
      legacyMeta: decodeMeta(allocations) };
  }

  // Opening a nonexistent database normally creates it: enumerate first, and
  // abort any unexpected upgrade (including a race with database deletion).
  async function readIndexed() {
    if (!global.indexedDB || typeof global.indexedDB.databases !== "function") {
      throw new Error("既存DB一覧を取得できません。DBを新規作成しないため取得を中止しました。");
    }
    const databases = await global.indexedDB.databases();
    if (!databases.some(db => db.name === "meat-production-db")) return { state: "missing", records: [], allocations: [], meta: [] };
    const db = await new Promise((resolve, reject) => {
      const request = global.indexedDB.open("meat-production-db");
      request.onupgradeneeded = () => request.transaction.abort();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error("既存IndexedDBを読み取れませんでした"));
      request.onblocked = () => reject(new Error("IndexedDBがブロックされています"));
    });
    try {
      const names = ["manufacturing_records", "manufacturing_allocations", "sync_meta"].filter(name => db.objectStoreNames.contains(name));
      if (!names.length) return { state: "no-stores", records: [], allocations: [], meta: [] };
      const result = await new Promise((resolve, reject) => {
        const transaction = db.transaction(names, "readonly");
        const rows = {};
        names.forEach(name => {
          const request = transaction.objectStore(name).getAll();
          request.onsuccess = () => { rows[name] = request.result; };
        });
        transaction.oncomplete = () => resolve(rows);
        transaction.onerror = transaction.onabort = () => reject(new Error("IndexedDB読み取りに失敗しました"));
      });
      return { state: "read", records: result.manufacturing_records || [], allocations: result.manufacturing_allocations || [], meta: result.sync_meta || [] };
    } finally { db.close(); }
  }

  // Own GET-only transport: no RPCs, caches, initializers or cloud mutations.
  async function readCloud(config) {
    if (!config || config.enabled === false || !config.url || !config.businessId || !config.publishableKey) {
      return { state: "unavailable", reason: "Supabase設定がありません", tables: {} };
    }
    // Do not call Auth.getSession/getAccessToken: the SDK may refresh a session
    // using POST and persist credentials. Read the existing default SDK session
    // solely for the GET authorization header; never include it in the report.
    let token = config.accessToken;
    if (!token) {
      try {
        const project = new URL(config.url).hostname.split(".")[0];
        const session = JSON.parse(global.localStorage.getItem(`sb-${project}-auth-token`) || "null");
        if (typeof session?.access_token === "string") token = session.access_token;
      } catch (_) { /* No session refresh or login is initiated by observation. */ }
    }
    if (!token) return { state: "unavailable", reason: "この端末の認証セッションがありません", tables: {} };
    const queries = {
      manufacturing_records: { select: "*,product:products(display_name,internal_code),recipe:recipes(display_name,internal_code)" },
      manufacturing_allocations: { select: "*" },
      saved_recipe_calculations: { select: "*" },
      packaging_master: { select: "*", internal_code: "eq.GIBIER_CENTER_STANDARD" },
      // All versions preserve historical version IDs as well as current weight.
      packaging_versions: { select: "*" },
      // Usually forbidden by schema; report the read error instead of invoking reservation RPC.
      manufacturing_lot_reservations: { select: "*", lot_base: "eq.20260728-IT-GIBIER" }
    };
    const tables = {};
    await Promise.allSettled(Object.entries(queries).map(async ([table, query]) => {
      const rows = [];
      let pages = 0;
      try {
        for (;;) {
          const params = new URLSearchParams({ ...query, business_id: `eq.${config.businessId}`, order: "id.asc", limit: "500", offset: String(rows.length) });
          // packaging_versions has no business_id; use its related master to scope RLS read.
          if (table === "packaging_versions") {
            params.delete("business_id");
            params.set("select", "*,packaging_master!inner(business_id,internal_code)");
            params.set("packaging_master.business_id", `eq.${config.businessId}`);
            params.set("packaging_master.internal_code", "eq.GIBIER_CENTER_STANDARD");
          }
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15000);
          let batch;
          try {
            const response = await global.fetch(`${config.url.replace(/\/$/, "")}/rest/v1/${table}?${params}`, {
              method: "GET", headers: { apikey: config.publishableKey, Authorization: `Bearer ${token}` }, signal: controller.signal
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            batch = await response.json();
            if (!Array.isArray(batch)) throw new Error("Response is not an array");
          } finally { clearTimeout(timeout); }
          pages++;
          // Detect ignored pagination rather than loop forever or claim completeness.
          if (batch.some(row => rows.some(old => old.id === row.id))) throw new Error("Pagination repeated IDs; incomplete read");
          rows.push(...batch);
          if (!batch.length) break;
        }
        tables[table] = { state: "read", pages, rows };
      } catch (error) { tables[table] = { state: "error", pages, rows, error: error.name === "AbortError" ? "timeout" : String(error.message) }; }
    }));
    return { state: "observed", tables };
  }

  function build(local, indexed, cloud) {
    const cloudRows = cloud.tables.manufacturing_records?.rows || [];
    const cloudAllocations = cloud.tables.manufacturing_allocations?.rows || [];
    const indexedRows = indexed.records.map(row => global.MeatHistoryRecovery.fromBundle({ record: row,
      allocations: indexed.allocations.filter(a => a.manufacturing_record_id === row.id) }));
    const sources = [
      ...array(local[KEYS[1]]).map(record => ({ source: "archive", record })),
      ...array(local[KEYS[0]]).map(record => ({ source: "local", record })),
      ...indexedRows.map(record => ({ source: "indexed", record }))
    ];
    const withCloud = [...sources, ...cloudRows.map(row => ({ source: "cloud", record: global.MeatHistoryRecovery.fromBundle({ record: row,
      allocations: cloudAllocations.filter(a => a.manufacturing_record_id === row.id) }) }))];
    const savedIds = new Set();
    const targetIds = new Set();
    const prepDates = new Set([DAY]);
    withCloud.filter(s => relevant(s.record)).forEach(({ record }) => {
      [record.id, record.cloudRecordId, record.manufacturingRecordId].filter(Boolean).forEach(id => targetIds.add(id));
      [record.savedRecipeId, record.savedCalculationId].filter(Boolean).forEach(id => savedIds.add(id));
      if (record.prepDate) prepDates.add(record.prepDate);
    });
    const savedRelevant = row => {
      const payload = row.payload || row;
      return [row.id, payload.id, payload.savedRecipeId, payload.cloudSavedRecipeId].some(id => savedIds.has(id)) ||
        (prepDates.has(row.prep_date ?? payload.prepDate) && global.MeatProductionSyncAdapter.internalCode(payload) === "GIBIER_CENTER");
    };
    const identity = row => fields(row, FIELDS.filter(key => !["memo", "recipeRows"].includes(key)));
    const layer = (rows, allocations) => ({ totalCount: rows.length,
      identities: rows.map(identity),
      targetRecords: rows.filter(row => relevant(row) || relevant(global.MeatHistoryRecovery.fromBundle({ record: row,
        allocations: allocations.filter(a => a.manufacturing_record_id === row.id) }))).map(row => observeRow(row, allocations.filter(a => a.manufacturing_record_id === row.id))),
      deletedRecords: rows.filter(row => row.status === "deleted").map(row => observeRow(row, allocations.filter(a => a.manufacturing_record_id === row.id))) });
    const timelines = {};
    for (const [name, rows] of [["current", array(local[KEYS[0]])], ["archive", array(local[KEYS[1]])], ["indexed", indexed.records], ["cloud", cloudRows]]) {
      timelines[name] = LOTS.map(target => ({ lot: target, rows: rows.filter(row => lot(row) === target).map(row => fields(row, FIELDS)) }));
      const a = rows.filter(row => lot(row) === LOTS[0]);
      const b = rows.filter(row => lot(row) === LOTS[1]);
      if (a.length === 1 && b.length === 1) {
        timelines[name].push({ creationDifferences: ["created_at", "createdAt", "savedAt"].map(key => {
          const first = a[0][key], second = b[0][key];
          const valid = typeof first === "string" && typeof second === "string" && Number.isFinite(Date.parse(first)) && Number.isFinite(Date.parse(second));
          return { field: key, first: value(first), second: value(second), seconds: valid ? (Date.parse(second) - Date.parse(first)) / 1000 : null };
        }) });
      }
    }
    return {
      interpretation: "生値と純粋な統合結果の観測。missing（プロパティなし）、undefined、null、empty-string、数値0、正数を区別。時刻差は作成イベントの証明ではありません。allocation作成時刻は再同期でも再発行されます。",
      localStorage: Object.fromEntries([KEYS[0], KEYS[1]].map(key => [key, { state: local[key].state, raw: local[key].raw, ...layer(array(local[key]), []) }])),
      indexedDB: { state: indexed.state, error: indexed.error, ...layer(indexed.records, indexed.allocations),
        targetAllocations: indexed.allocations.filter(a => targetIds.has(a.manufacturing_record_id)).map(a => ({ fields: fields(a, ALLOCATION_FIELDS), raw: a })), syncMeta: indexed.meta },
      supabase: { state: cloud.state, reason: cloud.reason,
        tables: Object.fromEntries(Object.entries(cloud.tables).map(([name, result]) => [name, { state: result.state, pages: result.pages, error: result.error, totalCount: result.rows.length,
          ...(name === "manufacturing_records" ? layer(result.rows, cloudAllocations) : { rows: name === "saved_recipe_calculations" ? result.rows.filter(savedRelevant) : name === "manufacturing_allocations" ? result.rows.filter(a => targetIds.has(a.manufacturing_record_id) || cloudRows.some(r => r.id === a.manufacturing_record_id && r.status === "deleted")) : result.rows }),
          ...(name === "saved_recipe_calculations" ? { observations: result.rows.filter(savedRelevant).map(row => ({ fields: fields(row, FIELDS), payloadFields: fields(row.payload || {}, FIELDS) })) } : {}) }])) },
      savedRecipes: Object.fromEntries([KEYS[2], KEYS[3]].map(key => [key, { state: local[key].state, rows: array(local[key]).filter(savedRelevant), observations: array(local[key]).filter(savedRelevant).map(row => fields(row, FIELDS)) }])),
      mastersAndDevice: Object.fromEntries(KEYS.slice(4).map(key => [key, local[key]])), timelines,
      canonicalObservation: {
        // Pure recovery only: do not call wrappers that normalize/persist masters or recipes.
        fullLocalTombstones: global.MeatHistoryRecovery.mergeHistory(sources),
        currentHistoryPathDeletedIndexedExcluded: global.MeatHistoryRecovery.mergeHistory(sources.filter(s => s.source !== "indexed" || s.record.status !== "deleted")),
        fullLocalAndCloudTombstones: global.MeatHistoryRecovery.mergeHistory(withCloud)
      }
    };
  }
  async function collect() {
    const startedAt = new Date().toISOString();
    const before = localSnapshot();
    let indexed;
    try { indexed = await readIndexed(); }
    catch (error) { indexed = { state: "error", error: String(error.message), records: [], allocations: [], meta: [] }; }
    let cloud;
    try { cloud = await readCloud(global.MEAT_SUPABASE_CONFIG); }
    catch (_) { cloud = { state: "error", reason: "認証セッションの読み取りに失敗しました", tables: {} }; }
    const after = localSnapshot();
    let indexedAfter;
    try { indexedAfter = await readIndexed(); } catch (_) { indexedAfter = null; }
    const changedKeys = KEYS.filter(key => before[key].raw !== after[key].raw);
    const dbChanged = indexedAfter ? JSON.stringify(indexed) !== JSON.stringify(indexedAfter) : null;
    return { format: "meat-record-observation-v1", baseline: "2c5fa57a9b6a90a05ded508e34c71e6f70e29406",
      startedAt, finishedAt: new Date().toISOString(), targetLots: LOTS, targetDay: DAY,
      consistency: { changedLocalStorageKeys: changedKeys, indexedChangedDuringRead: dbChanged,
        note: "診断は書き込みません。既存のバックグラウンド同期は独立して動作するため、保存層を跨ぐ原子的snapshotではありません。" },
      ...build(before, indexed, cloud),
      ...(changedKeys.length || dbChanged ? { changedDuringRead: { localStorageAfter: after, indexedAfter } } : {}) };
  }
  async function show() {
    if (document.getElementById("recordObservation")) return;
    // Mount outside app so an already-running history redraw cannot erase the
    // result or the copy button. This does not pause or change normal sync.
    const host = document.createElement("dialog");
    host.id = "recordObservation";
    host.setAttribute("aria-labelledby", "recordObservationTitle");
    host.style.cssText = "box-sizing:border-box;width:min(700px,calc(100vw - 32px));max-height:85vh;overflow:auto;border:1px solid #ccc;border-radius:12px;padding:20px;";
    host.innerHTML = '<h2 id="recordObservationTitle">重複・削除診断（読み取り専用）</h2><p role="status">保存層を読み取り中…</p><button id="recordObservationCopy" type="button" class="secondary" disabled>診断結果をコピー</button><textarea readonly aria-label="診断結果" style="width:100%;min-height:360px;margin:12px 0"></textarea><button id="recordObservationClose" type="button" class="secondary">閉じる</button>';
    document.body.appendChild(host);
    host.addEventListener("close", () => host.remove());
    host.querySelector("#recordObservationClose").addEventListener("click", () => host.close());
    host.showModal();
    const output = host.querySelector("textarea");
    const status = host.querySelector('[role="status"]');
    const button = host.querySelector("button");
    try {
      const report = await collect();
      output.value = JSON.stringify(report, null, 2);
      const incomplete = report.indexedDB.state === "error" || report.supabase.state !== "observed" ||
        Object.entries(report.supabase.tables).some(([key, result]) => key !== "manufacturing_lot_reservations" && result.state !== "read");
      status.textContent = incomplete ? "取得できない保存層があります。取得状況も含めて結果をコピーしてください。" : "診断結果を取得しました。結果をコピーしてください。";
      button.disabled = false;
      button.addEventListener("click", async () => {
        try {
          if (global.navigator.clipboard && global.navigator.clipboard.writeText) await global.navigator.clipboard.writeText(output.value);
          else { output.select(); if (!document.execCommand("copy")) throw new Error("copy failed"); }
          status.textContent = "診断結果をコピーしました。";
        } catch (_) {
          output.select();
          try { status.textContent = document.execCommand("copy") ? "診断結果をコピーしました。" : "コピーできませんでした。選択された診断結果をコピーしてください。"; }
          catch (_) { status.textContent = "コピーできませんでした。選択された診断結果をコピーしてください。"; }
        }
      });
    } catch (error) { status.textContent = "診断結果の取得に失敗しました。"; output.value = String(error.message); }
  }
  global.MeatRecordObservation = { collect, show, value, fields, build, readIndexed };
})(window);
