-- ============================================================================
-- XAUlytics — Supabase schema (schema xaulytics)
--
-- MetalpriceAPI → Python ETL (`xaulytics-etl`) upserts rates here; the static
-- dashboard reads via PostgREST using the publishable anon key + RLS.
-- Idempotent key: (pricing_date, quote_code, base_currency).
-- Optional retention: `xaulytics-etl retention` DELETEs old rows (service_role).
--
-- Apply in Supabase SQL editor or migrations. Expose schema xaulytics under
-- Project Settings → Data API. After DROP/CREATE on views, re-run the GRANT
-- blocks at the bottom (PostgreSQL drops privileges on replaced objects).
-- ============================================================================

create schema if not exists xaulytics;

-- Daily / historical spot (and optional bid/ask) rates per base_currency.
-- OHLC columns filled when METALPRICEAPI_ENABLE_OHLC=true on the ETL side.

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

-- One row per ETL run (daily, historical_manual, symbols_catalog). Not granted
-- to anon — browser dashboard does not read this table.

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

-- ---------------------------------------------------------------------------
-- MetalpriceAPI symbol catalog (GET /v1/symbols).
-- Populated/updated by `xaulytics-etl symbols`. `enabled_for_pricing` drives
-- which codes the daily/historical ETL requests from MetalpriceAPI.
-- Dashboard uses display_name (and related columns) for card labels.
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

-- ---------------------------------------------------------------------------
-- Stable view names for PostgREST / dashboard (default *_current relations).
-- security_invoker is set below so underlying table RLS applies when anon
-- selects through the view (PostgreSQL 15+).
-- ---------------------------------------------------------------------------

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

-- Mirror of etl_runs_v1 for stable naming; granted to service_role only below.

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
-- Row level security (RLS)
--
-- RLS is enabled on the tables above. This file does not CREATE POLICY rows;
-- add policies in Supabase (SQL or dashboard) so roles such as anon can
-- SELECT according to your rules. Without suitable policies, access may be
-- denied for non-owner roles even where GRANT SELECT exists.
-- ---------------------------------------------------------------------------

alter table xaulytics.metal_prices_v1 enable row level security;
alter table xaulytics.metalprice_api_symbols_v1 enable row level security;
alter table xaulytics.etl_runs_v1 enable row level security;

-- ---------------------------------------------------------------------------
-- service_role — ETL (`xaulytics-etl`) and retention job
--
-- DELETE on metal_prices_v1 is required for `xaulytics-etl retention` (prune
-- rows older than the configured calendar anchor window).
-- ---------------------------------------------------------------------------

grant usage on schema xaulytics to service_role;

grant select, insert, update, delete on table xaulytics.metal_prices_v1 to service_role;
grant select, insert, update on table xaulytics.metalprice_api_symbols_v1 to service_role;
grant select, insert, update on table xaulytics.etl_runs_v1 to service_role;

grant select on table xaulytics.metal_prices_current to service_role;
grant select on table xaulytics.metalprice_api_symbols_current to service_role;
grant select on table xaulytics.etl_runs_current to service_role;

-- ---------------------------------------------------------------------------
-- anon / authenticated — static dashboard (Supabase JS + publishable key)
--
-- 1) Run this SQL in Supabase (or ship as a migration on new projects).
-- 2) Project Settings → Data API → expose schema xaulytics for PostgREST.
-- 3) After DROP/CREATE on views, re-run this GRANT block (privileges on the
--    old view object are dropped when the view is recreated).
--
-- Grants: read prices and symbol catalog (display names, enabled flags).
-- etl_runs_v1 is not granted here — run metadata stays server-side only.
-- Combine with RLS policies you define separately for least privilege.
-- ---------------------------------------------------------------------------

grant usage on schema xaulytics to anon, authenticated;

grant select on table xaulytics.metal_prices_v1 to anon, authenticated;
grant select on table xaulytics.metal_prices_current to anon, authenticated;
grant select on table xaulytics.metalprice_api_symbols_v1 to anon, authenticated;
grant select on table xaulytics.metalprice_api_symbols_current to anon, authenticated;

-- Evaluate underlying table RLS as the querying role (dashboard anon JWT).

alter view xaulytics.metal_prices_current
set (security_invoker = on);

alter view xaulytics.metalprice_api_symbols_current
set (security_invoker = on);
