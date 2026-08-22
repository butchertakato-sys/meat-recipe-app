(function (global) {
  "use strict";

  let client = null;
  let currentConfig = null;
  let initializationPromise = null;

  function configured(config) {
    return Boolean(
      config &&
      config.enabled !== false &&
      config.url &&
      config.publishableKey
    );
  }

  function getClient() {
    if (!configured(currentConfig)) return null;
    if (client) return client;
    if (!global.supabase || typeof global.supabase.createClient !== "function") {
      throw new Error("Supabase Auth library is not available");
    }
    client = global.supabase.createClient(
      currentConfig.url.replace(/\/$/, ""),
      currentConfig.publishableKey,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false
        }
      }
    );
    return client;
  }

  async function initialize(config) {
    currentConfig = config || {};
    if (!configured(currentConfig)) {
      return { configured: false, session: null, user: null };
    }
    if (!initializationPromise) {
      initializationPromise = (async () => {
        const authClient = getClient();
        const { data, error } = await authClient.auth.getSession();
        if (error) throw error;
        const session = data && data.session ? data.session : null;
        return { configured: true, session, user: session ? session.user : null };
      })();
    }
    return initializationPromise;
  }

  async function signInWithPassword(email, password) {
    const authClient = getClient();
    if (!authClient) throw new Error("Supabase Auth is not configured");
    const { data, error } = await authClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    if (!data || !data.session || !data.session.access_token) {
      throw new Error("Supabase Auth session was not returned");
    }
    initializationPromise = Promise.resolve({
      configured: true,
      session: data.session,
      user: data.user || data.session.user || null
    });
    return data;
  }

  async function getSession() {
    const authClient = getClient();
    if (!authClient) return null;
    const { data, error } = await authClient.auth.getSession();
    if (error) throw error;
    return data && data.session ? data.session : null;
  }

  async function getAccessToken() {
    try {
      const session = await getSession();
      return session && session.access_token ? session.access_token : "";
    } catch (error) {
      console.warn("[Supabase Auth] access tokenを取得できませんでした。", error);
      return "";
    }
  }

  global.MeatProductionAuth = {
    initialize,
    signInWithPassword,
    getSession,
    getAccessToken,
    isConfigured: () => configured(currentConfig || global.MEAT_SUPABASE_CONFIG || {})
  };
})(window);
