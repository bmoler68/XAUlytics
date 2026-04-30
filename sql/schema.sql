create schema if not exists xaulytics;

create table if not exists xaulytics.metal_prices_v1 (
  pricing_date date not null,
  quote_code text not null,
  base_currency text not null default 'USD',
  quote_per_base numeric not null,
  price_usd numeric not null,
  unit text null,
  source_endpoint text not null,
  source_timestamp bigint null,
  ingested_at_utc timestamptz not null default now(),
  primary key (pricing_date, quote_code)
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

create or replace view xaulytics.metal_prices_current as
select
  pricing_date,
  quote_code,
  base_currency,
  quote_per_base,
  price_usd,
  unit,
  source_endpoint,
  source_timestamp,
  ingested_at_utc
from xaulytics.metal_prices_v1;

create or replace view xaulytics.etl_runs_current as
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
