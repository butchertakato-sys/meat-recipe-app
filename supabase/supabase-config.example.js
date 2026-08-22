// このファイルをsupabase-config.jsとして複製し、公開可能な値だけを設定する。
// service_role keyは絶対にブラウザへ設定しない。
window.MEAT_SUPABASE_CONFIG = {
  enabled: true,
  url: "https://YOUR_PROJECT.supabase.co",
  publishableKey: "YOUR_PUBLISHABLE_OR_ANON_KEY",
  businessId: "46e4f472-1d88-4a9d-b37a-bfbfd5773727",
  getAccessToken: async function () {
    // auth.jsが管理する現在のSupabase Authセッションを共通利用する。
    if (!window.MeatProductionAuth) return "";
    return await window.MeatProductionAuth.getAccessToken();
  },
  ids: {
    // internal_codeごとにSupabaseのUUIDを設定する。
    products: {},
    recipes: {},
    recipeVersions: {},
    packagingMasters: {},
    packagingVersions: {}
  }
};
