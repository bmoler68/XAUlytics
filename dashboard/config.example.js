window.XAULYTICS_DASHBOARD_CONFIG = {
  supabaseUrl: "https://your-project.supabase.co",
  supabaseAnonKey: "replace_with_public_anon_key",
  schema: "xaulytics",
  /** PostgREST relation for price reads (default stable view). Override with metal_prices_v1 only if needed. */
  pricesRelation: "metal_prices_current",
  /** Symbol catalog for display names on cards (GET /v1/symbols data). */
  symbolsRelation: "metalprice_api_symbols_current",
  baseCurrency: "USD",
  preciousMetals: ["XAU", "XAG", "XPT", "XPD", "XRH"],
  historyDays: 120,
};
