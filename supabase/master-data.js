(function (global) {
  "use strict";

  const CACHE_KEY = "meatRecipeApp.supabaseMasters.v1";
  const REQUEST_TIMEOUT_MS = 15000;
  let currentConfig = null;
  let currentData = null;
  let initializationPromise = null;

  function configured() {
    return Boolean(
      currentConfig &&
      currentConfig.enabled !== false &&
      currentConfig.url &&
      currentConfig.publishableKey &&
      currentConfig.businessId
    );
  }

  async function accessToken() {
    if (!currentConfig) return "";
    if (typeof currentConfig.getAccessToken === "function") {
      return await currentConfig.getAccessToken();
    }
    return currentConfig.accessToken || "";
  }

  function readCache() {
    try {
      const parsed = JSON.parse(global.localStorage.getItem(CACHE_KEY) || "null");
      return parsed && parsed.data ? parsed : null;
    } catch (error) {
      console.warn("[Supabaseマスタ] ローカルキャッシュを読み取れませんでした。", error);
      return null;
    }
  }

  function writeCache(data) {
    const cachedAt = new Date().toISOString();
    try {
      global.localStorage.setItem(CACHE_KEY, JSON.stringify({ cachedAt, data }));
    } catch (error) {
      console.warn("[Supabaseマスタ] ローカルキャッシュを保存できませんでした。", error);
    }
    return cachedAt;
  }

  function inFilter(ids) {
    return `in.(${ids.join(",")})`;
  }

  async function requestRows(table, parameters, token) {
    const params = new URLSearchParams(parameters || {});
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(
        `${currentConfig.url.replace(/\/$/, "")}/rest/v1/${table}?${params.toString()}`,
        {
          headers: {
            apikey: currentConfig.publishableKey,
            Authorization: `Bearer ${token}`
          },
          signal: controller.signal
        }
      );
    } finally {
      clearTimeout(timeoutId);
    }
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Supabase ${table} ${response.status}: ${detail.slice(0, 500)}`);
    }
    return await response.json();
  }

  function mapIds(data) {
    const config = currentConfig || {};
    config.ids = config.ids || {};
    config.ids.products = Object.fromEntries(data.products.map((row) => [row.internal_code, row.id]));
    config.ids.recipes = Object.fromEntries(data.recipes.map((row) => [row.internal_code, row.id]));
    config.ids.recipeVersions = {};
    data.recipeVersions.forEach((version) => {
      const recipe = data.recipes.find((row) => row.id === version.recipe_id);
      if (recipe) config.ids.recipeVersions[recipe.internal_code] = version.id;
    });
    const packagingMasters = Object.fromEntries(data.packagingMasters.map((row) => [row.internal_code, row.id]));
    const packagingVersions = {};
    data.packagingVersions.forEach((version) => {
      const master = data.packagingMasters.find((row) => row.id === version.packaging_master_id);
      if (master) packagingVersions[master.internal_code] = version.id;
    });
    config.ids.packagingMasters = packagingMasters;
    config.ids.packagingMaster = packagingMasters;
    config.ids.packagingVersions = packagingVersions;
  }

  function logSummary(data, source) {
    console.info(`[Supabaseマスタ] 読み込み成功（${source}）`);
    console.info(`[Supabaseマスタ] products: ${data.products.length}件`);
    console.info(`[Supabaseマスタ] recipes: ${data.recipes.length}件`);
    console.info(`[Supabaseマスタ] recipe_versions: ${data.recipeVersions.length}件`);
    console.info(`[Supabaseマスタ] recipe_ingredients: ${data.recipeIngredients.length}件`);
    console.info(`[Supabaseマスタ] packaging_master: ${data.packagingMasters.length}件`);
    console.info(`[Supabaseマスタ] packaging_versions: ${data.packagingVersions.length}件`);
  }

  function validateMasterCounts(data) {
    const expected = {
      products: 9,
      recipes: 8,
      recipeVersions: 8,
      recipeIngredients: 52,
      packagingMasters: 10,
      packagingVersions: 10
    };
    const mismatches = Object.entries(expected)
      .filter(([key, count]) => data[key].length !== count)
      .map(([key, count]) => `${key}: ${data[key].length}件（期待${count}件）`);
    if (mismatches.length) throw new Error(`正式マスタ件数が一致しません。${mismatches.join("、")}`);
  }

  function publish(data, source, extra) {
    currentData = data;
    mapIds(data);
    const detail = { success: true, source, data, ...(extra || {}) };
    global.dispatchEvent(new CustomEvent("meat-production-master-data", { detail }));
    logSummary(data, source);
    return detail;
  }

  async function fetchCloudMasters() {
    if (!configured()) throw new Error("Supabase master connection is not configured");
    const token = await accessToken();
    if (!token) throw new Error("Supabase authentication session is not available");
    const businessId = currentConfig.businessId;
    const products = await requestRows("products", {
      select: "*",
      business_id: `eq.${businessId}`,
      is_active: "eq.true",
      order: "sort_order.asc"
    }, token);
    const recipes = await requestRows("recipes", {
      select: "*",
      business_id: `eq.${businessId}`,
      is_active: "eq.true",
      order: "internal_code.asc"
    }, token);
    const recipeIds = recipes.map((row) => row.id);
    const recipeVersions = recipeIds.length ? await requestRows("recipe_versions", {
      select: "*",
      recipe_id: inFilter(recipeIds),
      is_current: "eq.true",
      order: "version_no.asc"
    }, token) : [];
    const recipeVersionIds = recipeVersions.map((row) => row.id);
    const recipeIngredients = recipeVersionIds.length ? await requestRows("recipe_ingredients", {
      select: "*",
      recipe_version_id: inFilter(recipeVersionIds),
      order: "sort_order.asc"
    }, token) : [];
    const packagingMasters = await requestRows("packaging_master", {
      select: "*",
      business_id: `eq.${businessId}`,
      is_active: "eq.true",
      order: "internal_code.asc"
    }, token);
    const packagingMasterIds = packagingMasters.map((row) => row.id);
    const packagingVersions = packagingMasterIds.length ? await requestRows("packaging_versions", {
      select: "*",
      packaging_master_id: inFilter(packagingMasterIds),
      is_current: "eq.true",
      order: "version_no.asc"
    }, token) : [];
    const data = {
      businessId,
      products,
      recipes,
      recipeVersions,
      recipeIngredients,
      packagingMasters,
      packagingVersions,
      fetchedAt: new Date().toISOString()
    };
    validateMasterCounts(data);
    return data;
  }

  async function refresh() {
    try {
      const data = await fetchCloudMasters();
      const cachedAt = writeCache(data);
      return publish(data, "supabase", { cachedAt });
    } catch (error) {
      console.error("[Supabaseマスタ] 取得失敗。ローカルマスタへフォールバックします。", error);
      const cached = readCache();
      if (cached) return publish(cached.data, "cache", { cachedAt: cached.cachedAt, error });
      const detail = { success: false, source: "local", data: null, error };
      global.dispatchEvent(new CustomEvent("meat-production-master-data", { detail }));
      return detail;
    }
  }

  function initialize(config) {
    currentConfig = config || {};
    if (!initializationPromise) initializationPromise = refresh();
    return initializationPromise;
  }

  global.MeatProductionMasterData = {
    initialize,
    refresh,
    getCurrent: () => currentData,
    getCached: readCache,
    cacheKey: CACHE_KEY
  };
})(window);
