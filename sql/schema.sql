create schema if not exists xaulytics;

create table if not exists xaulytics.metal_prices_v1 (
  pricing_date date not null,
  quote_code text not null,
  base_currency text not null default 'USD',
  quote_per_base numeric not null,
  price_base numeric not null,
  open_base numeric null,
  high_base numeric null,
  low_base numeric null,
  close_base numeric null,
  unit text null,
  source_endpoint text not null,
  source_timestamp bigint null,
  ingested_at_utc timestamptz not null default now(),
  primary key (pricing_date, quote_code, base_currency)
);

create index if not exists idx_metal_prices_v1_quote_code
  on xaulytics.metal_prices_v1 (quote_code);

create index if not exists idx_metal_prices_v1_pricing_date
  on xaulytics.metal_prices_v1 (pricing_date);

create table if not exists xaulytics.etl_runs_v1 (
  run_id uuid primary key,
  mode text not null,
  requested_start_date date null,
  requested_end_date date null,
  status text not null,
  row_count integer null,
  error_message text null,
  started_at_utc timestamptz not null,
  completed_at_utc timestamptz null
);

create index if not exists idx_etl_runs_v1_started_at
  on xaulytics.etl_runs_v1 (started_at_utc);

drop view if exists xaulytics.metal_prices_current;

create view xaulytics.metal_prices_current as
select
  pricing_date,
  quote_code,
  base_currency,
  quote_per_base,
  price_base,
  open_base,
  high_base,
  low_base,
  close_base,
  unit,
  source_endpoint,
  source_timestamp,
  ingested_at_utc
from xaulytics.metal_prices_v1;

drop view if exists xaulytics.etl_runs_current;

create view xaulytics.etl_runs_current as
select
  run_id,
  mode,
  requested_start_date,
  requested_end_date,
  status,
  row_count,
  error_message,
  started_at_utc,
  completed_at_utc
from xaulytics.etl_runs_v1;

-- ---------------------------------------------------------------------------
-- MetalpriceAPI supported symbols (reference catalog)
-- Populated by ETL: xaulytics-etl symbols (GET /v1/symbols).
-- ---------------------------------------------------------------------------

create table if not exists xaulytics.metalprice_api_symbols_v1 (
  symbol_code text primary key,
  display_name text not null,
  category text not null,
  unit text null,
  enabled_for_pricing boolean not null default false,
  source text not null default 'metalpriceapi.com/v1/symbols',
  documented_at timestamptz not null default now()
);

create index if not exists idx_metalprice_api_symbols_v1_category
  on xaulytics.metalprice_api_symbols_v1 (category);

create index if not exists idx_metalprice_api_symbols_v1_enabled_true
  on xaulytics.metalprice_api_symbols_v1 (symbol_code)
  where enabled_for_pricing = true;

drop view if exists xaulytics.metalprice_api_symbols_current;

create view xaulytics.metalprice_api_symbols_current as
select
  symbol_code,
  display_name,
  category,
  unit,
  enabled_for_pricing,
  source,
  documented_at
from xaulytics.metalprice_api_symbols_v1;

-- ---------------------------------------------------------------------------
-- Service role grants for ETL runtime
-- ---------------------------------------------------------------------------

grant usage on schema xaulytics to service_role;

grant select, insert, update on table xaulytics.metal_prices_v1 to service_role;
grant select, insert, update on table xaulytics.etl_runs_v1 to service_role;
grant select, insert, update on table xaulytics.metalprice_api_symbols_v1 to service_role;

grant select on table xaulytics.metal_prices_current to service_role;
grant select on table xaulytics.etl_runs_current to service_role;
grant select on table xaulytics.metalprice_api_symbols_current to service_role;

-- ---------------------------------------------------------------------------
-- PostgREST / browser dashboard (publishable anon JWT role).
-- 1) Run this SQL in Supabase (or apply full schema on new projects).
-- 2) Supabase Dashboard → Settings → Data API → add xaulytics to exposed schemas
--    so REST requests can use schema xaulytics.
-- 3) After DROP/CREATE on metal_prices_current, re-run grants (see grants_dashboard_anon.sql).
-- Grants below allow read-only price data only (no catalog / ETL run leakage).
-- ---------------------------------------------------------------------------

grant usage on schema xaulytics to anon, authenticated;

grant select on table xaulytics.metal_prices_v1 to anon, authenticated;
grant select on table xaulytics.metal_prices_current to anon, authenticated;
grant select on table xaulytics.metalprice_api_symbols_v1 to anon, authenticated;
grant select on table xaulytics.metalprice_api_symbols_current to anon, authenticated;

alter view xaulytics.metal_prices_current
set (security_invoker = on);

alter view xaulytics.metalprice_api_symbols_current
set (security_invoker = on);
