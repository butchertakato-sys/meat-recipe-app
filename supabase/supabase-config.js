(function () {
  "use strict";

  // 公開可能なSupabase設定だけをここへ設定します。
  // service_roleキーはブラウザへ絶対に置かないでください。
  window.MEAT_SUPABASE_CONFIG = window.MEAT_SUPABASE_CONFIG || {
    enabled: true,
    url: "https://svubltyedaayskqenuxw.supabase.co",
    publishableKey: "sb_publishable_YTk3wsmukDivOgNDcqF9Bg_4Lj-VCQB",
    businessId: "46e4f472-1d88-4a9d-b37a-bfbfd5773727",
    getAccessToken: async function () {
      if (!window.MeatProductionAuth) return "";
      return await window.MeatProductionAuth.getAccessToken();
    },
    ids: {
      products: {},
      recipes: {},
      recipeVersions: {},
      packagingMasters: {},
      packagingVersions: {}
    }
  };
})();
