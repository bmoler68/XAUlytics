# XAUlytics

Python ETL application that pulls MetalpriceAPI market rates and loads normalized records into Supabase.

## What Was Implemented

- Python package with clear ETL separation:
  - `extract` (`src/xaulytics_etl/extract.py`)
  - `transform` (`src/xaulytics_etl/transform.py`)
  - `load` (`src/xaulytics_etl/load.py`)
  - orchestration (`src/xaulytics_etl/etl.py`)
  - CLI entrypoint (`src/xaulytics_etl/cli.py`)
- Runtime modes:
  - `daily`: pulls most current rates from `/v1/latest` using `currencies=` built from DB rows where `enabled_for_pricing=true`
  - `historical` (manual): supports single date or date range using:
    - `/v1/YYYY-MM-DD` for single date
    - `/v1/timeframe` for date ranges
  - `symbols`: loads `/v1/symbols` into `metalprice_api_symbols_v1` (documented as not counting toward monthly API quota)
- Supabase naming/versioning convention applied:
  - schema: `xaulytics`
  - tables: `metal_prices_v1`, `etl_runs_v1`, `metalprice_api_symbols_v1` (reference catalog; filled via `xaulytics-etl symbols`)
  - stable views: `metal_prices_current`, `etl_runs_current`, `metalprice_api_symbols_current`
  - SQL setup file: `sql/schema.sql` (DDL only for symbols table; run `symbols` command after schema apply)
- Idempotent load behavior via upsert on `(pricing_date, quote_code)`.
- Structured JSON logging for ETL phases and run metadata.
- Dockerfile for Linux container execution.
- GitHub Actions workflow for daily scheduled runs (`.github/workflows/daily-etl.yml`).
- Unit tests: `tests/test_transform.py`, `tests/test_symbol_catalog.py`

## API Endpoints Used

Based on your requirements and previous planning:

- `GET /v1/latest` for daily mode (most current available closing-like delayed data on free plan)
- `GET /v1/YYYY-MM-DD` for historical single-date mode
- `GET /v1/timeframe` for manual historical date-range mode
- `GET /v1/symbols` for symbol catalog sync (`xaulytics-etl symbols`; quota-free per MetalpriceAPI docs)

MetalpriceAPI free-tier responses require an explicit `currencies` list. Daily and historical runs read enabled codes from `xaulytics.metalprice_api_symbols_v1.enabled_for_pricing` (set in the database after symbol sync).

## Data Model

### `xaulytics.metal_prices_v1`

- `pricing_date` (date, PK component)
- `quote_code` (text, PK component)
- `base_currency` (text, expected `USD`)
- `quote_per_base` (numeric): quote units per 1 base currency
- `price_usd` (numeric): inverse of `quote_per_base`
- `unit` (text, nullable): inferred unit where possible
- `source_endpoint` (text)
- `source_timestamp` (bigint, nullable)
- `ingested_at_utc` (timestamptz)

### `xaulytics.etl_runs_v1`

- `run_id` (uuid, PK)
- `mode` (`daily`, `historical_manual`, `symbols_catalog`)
- `requested_start_date`, `requested_end_date`
- `status` (`started`, `success`, `failed`)
- `row_count`
- `error_message`
- `started_at_utc`, `completed_at_utc`

### `xaulytics.metalprice_api_symbols_v1`

Reference rows loaded from MetalpriceAPI `GET /v1/symbols` via `xaulytics-etl symbols`. Use for joins, validation, and labeling. `display_name` comes from the API; `category` and `unit` are best-effort heuristics in `src/xaulytics_etl/symbol_catalog.py` (unknown codes default to `currency` with null unit).

- `symbol_code` (text, PK)
- `display_name` (text)
- `category` (text): `precious_metals`, `metals`, `india_gold`, `india_silver`, `cryptocurrency`, `energy`, `currency`
- `unit` (text, nullable): normalized units such as `troy_ounce`, `ounce`, `per_barrel`, `per_gallon`, `per_mmbtu`
- `enabled_for_pricing` (boolean): when `true`, daily/historical ETL includes this `symbol_code` in MetalpriceAPI `currencies` requests
- `source` (text): `metalpriceapi.com/v1/symbols` on rows written by this ETL
- `documented_at` (timestamptz)

Downstream queries should prefer `xaulytics.metalprice_api_symbols_current` (stable name) over the versioned table when you introduce `_v2` later.

## Configuration

Use environment variables (no secrets hardcoded):

- `METALPRICEAPI_API_KEY`
- `METALPRICEAPI_BASE_URL` (default: `https://api.metalpriceapi.com`)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_SCHEMA` (default: `xaulytics`)
- `SUPABASE_METAL_PRICES_TABLE` (default: `metal_prices_v1`)
- `SUPABASE_ETL_RUNS_TABLE` (default: `etl_runs_v1`)
- `SUPABASE_SYMBOLS_TABLE` (default: `metalprice_api_symbols_v1`)
- `LOG_LEVEL` (default: `INFO`)

See `.env.example`.

## Local Development

1. Create virtual environment and install:
   - `python -m venv .venv`
   - `.venv\Scripts\activate` (Windows)
   - `pip install -e .[dev]`
2. Set local environment variables (optionally sourced from Windows Credential Manager).
3. Run schema SQL in Supabase (`sql/schema.sql`).
4. Load symbol catalog once (and after API adds new codes): `xaulytics-etl symbols`
5. Enable pricing symbols in Supabase (example):

```sql
update xaulytics.metalprice_api_symbols_v1
set enabled_for_pricing = true
where symbol_code in ('XAU','XAG','XPT','XPD','XRH','ALU','XCU','NI','ZNC');
```

6. Run ETL:
   - Daily: `xaulytics-etl daily`
   - Historical one day: `xaulytics-etl historical --start-date 2026-04-01`
   - Historical range: `xaulytics-etl historical --start-date 2026-04-01 --end-date 2026-04-10`

If no rows have `enabled_for_pricing=true`, daily/historical runs fail fast with a clear configuration error.

## Docker

Build and run:

- `docker build -t xaulytics-etl:latest .`
- `docker run --rm --env-file .env xaulytics-etl:latest daily`

Historical manual run in container:

- `docker run --rm --env-file .env xaulytics-etl:latest historical --start-date 2026-04-01 --end-date 2026-04-05`

Symbol catalog sync in container:

- `docker run --rm --env-file .env xaulytics-etl:latest symbols`

## GitHub Actions

Workflows:

- Daily ETL scheduler: `.github/workflows/daily-etl.yml` (runs `xaulytics-etl symbols` then `xaulytics-etl daily`)
- Historical ETL (manual only): `.github/workflows/historical-etl.yml` (runs `symbols` then `historical` for the chosen date range)
- CI tests (manual only): `.github/workflows/ci.yml`

Configure these repository secrets:

- `METALPRICEAPI_API_KEY`
- `METALPRICEAPI_BASE_URL` (optional; defaults to US endpoint if omitted locally)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

### Running CI Manually

1. Open your repository in GitHub.
2. Go to **Actions**.
3. Select the **CI** workflow.
4. Click **Run workflow** and start the run.

The CI workflow runs `pytest` using Python 3.12 and does not auto-run on push or pull request.

### Running Historical ETL Manually

1. Open your repository in GitHub.
2. Go to **Actions**.
3. Select **Historical ETL (Manual)**.
4. Click **Run workflow**.
5. Provide:
   - `start_date` in `YYYY-MM-DD`
   - `end_date` in `YYYY-MM-DD`
6. Start the run.

The workflow first syncs the symbol catalog (`xaulytics-etl symbols`), then runs `xaulytics-etl historical --start-date <start_date> --end-date <end_date>`.

## Attribution Requirement

When data is displayed in docs/pages, include:

- Text: `Powered by <a href="https://metalpriceapi.com/" title="Free Precious Metal Rates API">MetalpriceAPI.com</a>`
- Image: `<a href="https://metalpriceapi.com/" title="Free Precious Metal Rates API"><img src='https://metalpriceapi.com/logo-dark.png' alt="Precious metal data by MetalpriceAPI.com" border="0" height="26"></a>`

## What Still Needs To Be Done

- Run SQL migration in your Supabase project and verify permissions for service-role usage.
- Add integration tests with mocked MetalpriceAPI and Supabase responses.
- Add request-budget guardrails (for free-plan limit monitoring and abort thresholds).
- Tighten symbol `category`/`unit` heuristics if MetalpriceAPI adds codes that do not match current patterns (unknown codes default to `currency`).
- Add retry/backoff policy with explicit jitter and failure classification (currently relies on request exceptions and run-failure logging).
- Add alerting/notifications for failed scheduled runs (email/Slack/etc.).

## Notes About Closing Prices

On free plan, MetalpriceAPI provides daily delayed data. This ETL treats that as the most current closing-style value available for daily ingestion. For manual historical loads, specific dates and date ranges are supported through historical/timeframe endpoints.
