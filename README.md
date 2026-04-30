# XAUlytics

Python ETL application that pulls MetalpriceAPI market rates and loads normalized records into Supabase.

## What Was Implemented

- Python package with clear ETL separation:
  - `extract` (`src/xaulytics_etl/extract.py`)
  - `transform` (`src/xaulytics_etl/transform.py`)
  - `load` (`src/xaulytics_etl/load.py`)
  - orchestration (`src/xaulytics_etl/etl.py`)
  - CLI entrypoint (`src/xaulytics_etl/cli.py`)
- Two runtime modes:
  - `daily`: pulls most current rates from `/v1/latest`
  - `historical` (manual): supports single date or date range using:
    - `/v1/YYYY-MM-DD` for single date
    - `/v1/timeframe` for date ranges
- Supabase naming/versioning convention applied:
  - schema: `xaulytics`
  - tables: `metal_prices_v1`, `etl_runs_v1`
  - SQL setup file: `sql/schema.sql`
- Idempotent load behavior via upsert on `(pricing_date, quote_code)`.
- Structured JSON logging for ETL phases and run metadata.
- Dockerfile for Linux container execution.
- GitHub Actions workflow for daily scheduled runs (`.github/workflows/daily-etl.yml`).
- Basic transform tests (`tests/test_transform.py`).

## API Endpoints Used

Based on your requirements and previous planning:

- `GET /v1/latest` for daily mode (most current available closing-like delayed data on free plan)
- `GET /v1/YYYY-MM-DD` for historical single-date mode
- `GET /v1/timeframe` for manual historical date-range mode
- `GET /v1/symbols` available in client (for metadata/validation if needed later)

The ETL currently requests all rates returned by those endpoints (including Indian symbols when provided by API response), without hardcoded allow-lists.

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
- `mode` (`daily`, `historical_manual`)
- `requested_start_date`, `requested_end_date`
- `status` (`started`, `success`, `failed`)
- `row_count`
- `error_message`
- `started_at_utc`, `completed_at_utc`

## Configuration

Use environment variables (no secrets hardcoded):

- `METALPRICEAPI_API_KEY`
- `METALPRICEAPI_BASE_URL` (default: `https://api.metalpriceapi.com`)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_SCHEMA` (default: `xaulytics`)
- `SUPABASE_METAL_PRICES_TABLE` (default: `metal_prices_v1`)
- `SUPABASE_ETL_RUNS_TABLE` (default: `etl_runs_v1`)
- `LOG_LEVEL` (default: `INFO`)

See `.env.example`.

## Local Development

1. Create virtual environment and install:
   - `python -m venv .venv`
   - `.venv\Scripts\activate` (Windows)
   - `pip install -e .[dev]`
2. Set local environment variables (optionally sourced from Windows Credential Manager).
3. Run schema SQL in Supabase (`sql/schema.sql`).
4. Run ETL:
   - Daily: `xaulytics-etl daily`
   - Historical one day: `xaulytics-etl historical --start-date 2026-04-01`
   - Historical range: `xaulytics-etl historical --start-date 2026-04-01 --end-date 2026-04-10`

## Docker

Build and run:

- `docker build -t xaulytics-etl:latest .`
- `docker run --rm --env-file .env xaulytics-etl:latest daily`

Historical manual run in container:

- `docker run --rm --env-file .env xaulytics-etl:latest historical --start-date 2026-04-01 --end-date 2026-04-05`

## GitHub Actions

Workflows:

- Daily ETL scheduler: `.github/workflows/daily-etl.yml`
- Historical ETL (manual only): `.github/workflows/historical-etl.yml`
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

The workflow executes `xaulytics-etl historical --start-date <start_date> --end-date <end_date>`.

## Attribution Requirement

When data is displayed in docs/pages, include:

- Text: `Powered by <a href="https://metalpriceapi.com/" title="Free Precious Metal Rates API">MetalpriceAPI.com</a>`
- Image: `<a href="https://metalpriceapi.com/" title="Free Precious Metal Rates API"><img src='https://metalpriceapi.com/logo-dark.png' alt="Precious metal data by MetalpriceAPI.com" border="0" height="26"></a>`

## What Still Needs To Be Done

- Run SQL migration in your Supabase project and verify permissions for service-role usage.
- Add integration tests with mocked MetalpriceAPI and Supabase responses.
- Add request-budget guardrails (for free-plan limit monitoring and abort thresholds).
- Decide how you want to classify and persist units for non-metal forex symbols (current implementation leaves unclear cases as null).
- Add retry/backoff policy with explicit jitter and failure classification (currently relies on request exceptions and run-failure logging).
- Add alerting/notifications for failed scheduled runs (email/Slack/etc.).

## Notes About Closing Prices

On free plan, MetalpriceAPI provides daily delayed data. This ETL treats that as the most current closing-style value available for daily ingestion. For manual historical loads, specific dates and date ranges are supported through historical/timeframe endpoints.
