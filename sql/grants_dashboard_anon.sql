-- Re-runnable PostgREST / dashboard grants for anon + authenticated (browser publishable key).
-- Run in Supabase SQL Editor after creating or recreating views (DROP VIEW drops privileges on the old object).

grant usage on schema xaulytics to anon, authenticated;

grant select on table xaulytics.metal_prices_v1 to anon, authenticated;
grant select on table xaulytics.metal_prices_current to anon, authenticated;
grant select on table xaulytics.metalprice_api_symbols_v1 to anon, authenticated;
grant select on table xaulytics.metalprice_api_symbols_current to anon, authenticated;
