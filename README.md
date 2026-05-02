# XAUlytics

**Demonstration Metal Price ETL** — ingests metal and FX-related quotes from [MetalpriceAPI](https://metalpriceapi.com/), normalizes them in **Python**, and loads idempotent rows into **Supabase** (PostgreSQL). The stack includes **Docker** (containerized CLI for Linux-style runs anywhere) and **GitHub Actions** for scheduled jobs. Use it as a reference for extract → transform → load layout, environment-driven configuration, and automation.

## What this project demonstrates

- **Separation of concerns**: `extract` (HTTP client), `transform` (pure normalization), `load` (Supabase upserts), `etl` orchestration, CLI entrypoint.
- **Operational hygiene**: configuration only from environment variables; structured logging; run logs in `etl_runs_v1`; upserts keyed by `(pricing_date, quote_code)` so reruns do not duplicate rows.
- **API-conscious design**: builds explicit `currencies=` lists from the symbol catalog (`enabled_for_pricing`) so requests stay predictable and minimal.
- **Automation-friendly**: Dockerfile for Linux-style runs; workflows for scheduled daily loads and optional manual historical backfills.

## Requirements

- **Python** 3.12+
- **Supabase** project (service role or compatible secret key for server-side writes)
- **MetalpriceAPI** account and API key ([MetalpriceAPI documentation](https://metalpriceapi.com/documentation))

## Repository layout

| Path | Role |
|------|------|
| `src/xaulytics_etl/extract.py` | MetalpriceAPI client (`requests`) |
| `src/xaulytics_etl/transform.py` | Payload → typed rate records |
| `src/xaulytics_etl/load.py` | Supabase upserts and run logging |
| `src/xaulytics_etl/etl.py` | Mode orchestration (`daily`, `historical`, `symbols`) |
| `src/xaulytics_etl/cli.py` | `xaulytics-etl` CLI |
| `sql/schema.sql` | Schema `xaulytics`, tables, views |
| `.github/workflows/` | Scheduled daily ETL, manual historical, manual CI |

## Quick start

1. Clone the repository and create a virtual environment:

   ```bash
   python -m venv .venv
   .venv\Scripts\activate   # Windows
   # source .venv/bin/activate   # Linux / macOS
   pip install -e ".[dev]"
   ```

2. Copy `.env.example` to `.env` and set secrets (never commit `.env`).

3. In Supabase, run `sql/schema.sql` (SQL editor or migration). Ensure the **`xaulytics`** schema is exposed to PostgREST if you query it from client apps.

4. Sync the symbol catalog:

   ```bash
   xaulytics-etl symbols
   ```

5. Choose which symbols participate in pricing requests by setting `enabled_for_pricing = true` (this ETL builds the MetalpriceAPI `currencies` parameter from these rows):

   ```sql
   update xaulytics.metalprice_api_symbols_v1
   set enabled_for_pricing = true
   where symbol_code in ('XAU','XAG','XPT','XPD','XRH','ALU','XCU','NI','ZNC');
   ```

6. Run loads:

   ```bash
   xaulytics-etl daily
   xaulytics-etl historical --start-date 2026-04-01
   xaulytics-etl historical --start-date 2026-04-01 --end-date 2026-04-10
   ```

If no symbols have `enabled_for_pricing = true`, **daily** and **historical** commands exit early with a clear configuration error.

## CLI modes

| Command | Behavior |
|---------|-----------|
| `xaulytics-etl symbols` | `GET /v1/symbols` → upsert reference catalog (`metalprice_api_symbols_v1`). |
| `xaulytics-etl daily` | `GET /v1/yesterday` with `base=USD` and DB-driven `currencies`. Loads the **prior UTC calendar day** (schedule after MetalpriceAPI publishes prior-day history; they document availability from **00:05 GMT**). |
| `xaulytics-etl historical` | Single date: `GET /v1/YYYY-MM-DD`. Range: `GET /v1/timeframe`. Same `currencies` behavior as daily. |

All USD-base conventions and unit hints follow transform logic in `transform.py` and `symbol_catalog.py`.

## MetalpriceAPI endpoints

| Endpoint | Used by |
|----------|---------|
| `GET /v1/yesterday` | `daily` |
| `GET /v1/YYYY-MM-DD` | `historical` (single date) |
| `GET /v1/timeframe` | `historical` (range) |
| `GET /v1/symbols` | `symbols` |

This project builds the **`currencies`** query parameter from `metalprice_api_symbols_v1.enabled_for_pricing`.

### Daily timing note

MetalpriceAPI describes **prior-day** historical data as available from **00:05 GMT**. The included GitHub Action schedules **daily** around **00:10 UTC** so `/v1/yesterday` is likely populated. Adjust cron if your provider window differs.

## Configuration

Read from the environment (see `.env.example`):

| Variable | Purpose |
|----------|---------|
| `METALPRICEAPI_API_KEY` | API key |
| `METALPRICEAPI_BASE_URL` | Default `https://api.metalpriceapi.com` (include `https://`) |
| `SUPABASE_URL` | Project URL (no `/rest/v1/` suffix) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side key (CI: GitHub Secret only) |
| `SUPABASE_SCHEMA` | Default `xaulytics` |
| `SUPABASE_METAL_PRICES_TABLE` | Default `metal_prices_v1` |
| `SUPABASE_ETL_RUNS_TABLE` | Default `etl_runs_v1` |
| `SUPABASE_SYMBOLS_TABLE` | Default `metalprice_api_symbols_v1` |
| `LOG_LEVEL` | Default `INFO` |

## Data model (schema `xaulytics`)

### `metal_prices_v1`

Normalized rates: composite primary key `(pricing_date, quote_code)`. Includes `quote_per_base`, `price_usd`, optional `unit`, `source_endpoint`, `source_timestamp`, `ingested_at_utc`.

### `etl_runs_v1`

One row per run: `run_id`, `mode`, optional requested date range, `status`, `row_count`, `error_message`, timestamps.

### `metalprice_api_symbols_v1`

Catalog from `GET /v1/symbols`. Important column: **`enabled_for_pricing`** — drives `currencies` for pricing endpoints. Stable view: `metalprice_api_symbols_current`.

Views **`metal_prices_current`**, **`etl_runs_current`**, **`metalprice_api_symbols_current`** mirror versioned tables for stable downstream naming.

## Docker

```bash
docker build -t xaulytics-etl:latest .
docker run --rm --env-file .env xaulytics-etl:latest daily
docker run --rm --env-file .env xaulytics-etl:latest historical --start-date 2026-04-01 --end-date 2026-04-05
docker run --rm --env-file .env xaulytics-etl:latest symbols
```

## GitHub Actions

| Workflow | Purpose |
|----------|---------|
| `daily-etl.yml` | Schedule: `symbols` then `daily` |
| `historical-etl.yml` | Manual: inputs `start_date` / `end_date`, then `symbols` + `historical` |
| `ci.yml` | Manual `pytest` (Python 3.12) |

Repository secrets (names must match workflow `env`): `METALPRICEAPI_API_KEY`, `METALPRICEAPI_BASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

### Run CI from GitHub

**Actions** → **CI** → **Run workflow**.

### Run historical ETL from GitHub

**Actions** → **Historical ETL (Manual)** → **Run workflow** → set `start_date` and `end_date` (`YYYY-MM-DD`).

## Tests

```bash
pip install -e ".[dev]"
pytest
```

## Attribution

MetalpriceAPI requires attribution when displaying derived data. Use exactly (vendor-supplied link titles):

**Text**

```html
Powered by <a href="https://metalpriceapi.com/" title="Free Precious Metal Rates API">MetalpriceAPI.com</a>
```

**Image**

```html
<a href="https://metalpriceapi.com/" title="Free Precious Metal Rates API"><img src='https://metalpriceapi.com/logo-dark.png' alt="Precious metal data by MetalpriceAPI.com" border="0" height="26"></a>
```

## License

This project is licensed under the MIT License.

Copyright (c) 2026 Brian Moler

See [LICENSE](LICENSE).

## Contributing

Since this application is an experiment in AI development, contributions are not currently being accepted. This allows the project to remain completely AI-developed and maintained, which is central to the experimental nature of this project. However, you are free to clone the repository and create your own forks or modifications for personal use.
