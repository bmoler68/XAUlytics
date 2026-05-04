window.XAULYTICS_DASHBOARD_CONFIG = {
  supabaseUrl: "https://your-project.supabase.co",
  /** Public anon key only; enforce reads with Supabase RLS (never embed the service role in static JS). */
  supabaseAnonKey: "replace_with_public_anon_key",
  schema: "xaulytics",
  /** PostgREST relation for price reads (default stable view). Override with metal_prices_v1 only if needed. */
  pricesRelation: "metal_prices_current",
  /** Symbol catalog for display names on cards (GET /v1/symbols data). */
  symbolsRelation: "metalprice_api_symbols_current",
  /** Initial base (must exist in baseCurrencies). Dropdown switches metal_prices rows by base_currency. */
  baseCurrency: "USD",
  /** ISO codes shown in the header dropdown (must match bases your ETL loads). */
  baseCurrencies: ["USD", "CAD", "AUD", "EUR", "GBP"],
  preciousMetals: ["XAU", "XAG", "XPT", "XPD", "XRH"],
  historyDays: 120,
  /** Optional: max spot rows loaded for the performance table (default 5000). Omit unless you need deeper history. */
  performanceSpotRowLimit: 5000,
};
