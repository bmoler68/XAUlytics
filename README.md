# XAUlytics

**Precious Metal Price Automated ETL Flow** — ingests metal and FX-related quotes from [MetalpriceAPI](https://metalpriceapi.com/), normalizes them in **Python**, and loads idempotent rows into **Supabase** (PostgreSQL). A **static browser dashboard** reads pricing and symbol catalog data from Supabase only (no MetalpriceAPI calls from the browser). The stack includes **Docker** (containerized CLI for Linux-style runs anywhere) and **GitHub Actions** for scheduled jobs. Use it as a reference for extract → transform → load layout, environment-driven configuration, and automation.

## What this project demonstrates

- **Separation of concerns**: `extract` (HTTP client), `transform` (pure normalization), `load` (Supabase upserts), `etl` orchestration, CLI entrypoint.
- **Operational hygiene**: configuration only from environment variables; JSON logs to stdout; run logs in `etl_runs_v1`; upserts keyed by **`(pricing_date, quote_code, base_currency)`** so reruns do not duplicate rows.
- **API-conscious design**: builds explicit `currencies=` lists from the symbol catalog (`enabled_for_pricing`) so requests stay predictable and minimal.
- **Multi-base spot loads**: `METALPRICEAPI_BASE_CURRENCIES` drives one MetalpriceAPI spot request per base (`/v1/yesterday`, `/v1/{date}`, `/v1/timeframe`). Optional **`METALPRICEAPI_ENABLE_OHLC`** adds **`GET /v1/ohlc`** per stored row (pair uses that row’s `base_currency`).
- **Bid/ask style symbols**: when enabled in the catalog (e.g. `XAU-BID`, `XAU-ASK`), they load like other quotes and can appear in the dashboard cards alongside spot.
- **Read-only dashboard**: static HTML/JS over **Supabase `anon` + RLS**; no API keys in the browser except the publishable key. Spot **performance** uses calendar-anchored returns (exact `pricing_date` matches) and extra queries for anchor dates so long lookbacks are not cut off by PostgREST row limits.
- **Automation-friendly**: Dockerfile for Linux-style runs; workflows for scheduled daily loads and optional manual historical backfills; optional local dashboard via `dashboard/serve.py`.

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
| `src/xaulytics_etl/config.py` / `env_parsing.py` | Settings from environment variables |
| `src/xaulytics_etl/ohlc_params.py` | `/v1/ohlc` query params from symbol + `base_currency` |
| `src/xaulytics_etl/models.py` | `RateRecord`, `SymbolCatalogRecord` |
| `src/xaulytics_etl/symbol_catalog.py` | Symbol metadata heuristics from `/v1/symbols` |
| `src/xaulytics_etl/logging_utils.py` | JSON log formatter |
| `src/xaulytics_etl/etl.py` | Orchestration: `daily`, `historical`, `symbols` |
| `src/xaulytics_etl/retention.py` | Price retention: delete rows older than the dashboard anchor window (`xaulytics-etl retention`) |
| `src/xaulytics_etl/cli.py` | `xaulytics-etl` CLI entrypoint |
| `sql/schema.sql` | Schema **`xaulytics`**, tables, indexes, views (**`security_invoker`** on price/symbol current views), **`service_role`** grants, **`anon` / `authenticated`** read grants for dashboard |
| `dashboard/` | Static UI: `index.html`, `app.js`, `styles.css` (Chart.js + Supabase JS from CDN); copy **`config.example.js`** → **`config.js`** (gitignored) |
| `dashboard/serve.py` | Local static HTTP server (`python dashboard/serve.py`) |
| `.github/workflows/` | Scheduled daily ETL, manual historical, manual CI (`pytest`) |

## Quick start

1. Clone the repository and create a virtual environment:

   ```bash
   python -m venv .venv
   .venv\Scripts\activate   # Windows
   # source .venv/bin/activate   # Linux / macOS
   pip install -e ".[dev]"
   ```

2. Copy `.env.example` to `.env` and set secrets (never commit `.env`). Optional: set **`METALPRICEAPI_BASE_CURRENCIES`** (default when unset is **`USD`** only) and **`METALPRICEAPI_ENABLE_OHLC`** (`true`/`false`).

3. In Supabase, run **`sql/schema.sql`** (SQL editor or migration). It creates schema **`xaulytics`**, tables with primary key **`(pricing_date, quote_code, base_currency)`**, indexes, mirror views (`*_current`), **`security_invoker`** on **`metal_prices_current`** and **`metalprice_api_symbols_current`**, grants for **`service_role`**, and read grants for **`anon` / `authenticated`** used by the dashboard. **Project Settings → Data API:** expose schema **`xaulytics`** for REST. If you **`DROP` / `CREATE`** a view, PostgreSQL drops privileges on the old object — copy the **`anon` / `authenticated`** **`GRANT`** block from the bottom of **`sql/schema.sql`** into the SQL editor and run it again.

4. Sync the symbol catalog:

   ```bash
   xaulytics-etl symbols
   ```

5. Choose which symbols participate in pricing requests by setting `enabled_for_pricing = true` (this ETL builds the MetalpriceAPI `currencies` parameter from these rows). Include **`…-BID`** / **`…-ASK`** pairs if you want bid/ask on dashboard cards (example shows spot precious metal only):

   ```sql
   update xaulytics.metalprice_api_symbols_v1
   set enabled_for_pricing = true
   where category = 'precious_metals'
   ;
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
| `xaulytics-etl daily` | For each configured **`METALPRICEAPI_BASE_CURRENCIES`**, `GET /v1/yesterday` with that `base` and DB-driven `currencies`; optionally **`GET /v1/ohlc`** per row when **`METALPRICEAPI_ENABLE_OHLC=true`**. Prior UTC calendar day — schedule after MetalpriceAPI publishes prior-day history (**00:05 GMT** per their docs). |
| `xaulytics-etl historical` | Same bases and optional OHLC as daily; spot via single-date or `timeframe`. Same `currencies` list for every base. |
| `xaulytics-etl retention` | Deletes **`metal_prices_v1`** rows with **`pricing_date`** strictly before **`global MAX(pricing_date)` minus `RETENTION_ANCHOR_YEARS` calendar years** (default **5**, matching the dashboard **5y** anchor). Use **`--dry-run`** to log counts only. Requires **`service_role`** **`DELETE`** on **`metal_prices_v1`** (see **`sql/schema.sql`**). |

Spot **`price_base`** and unit hints follow `transform.py` and `symbol_catalog.py`. OHLC pair orientation (`base` / `currency`) follows `ohlc_params.py`.

## MetalpriceAPI endpoints

| Endpoint | Used by |
|----------|---------|
| `GET /v1/yesterday` | `daily` — one call **per** configured `METALPRICEAPI_BASE_CURRENCIES` value (spot; then optional OHLC per row) |
| `GET /v1/YYYY-MM-DD` | `historical` single date — one call per base (optional OHLC per row) |
| `GET /v1/timeframe` | `historical` range — one call per base (optional OHLC per row) |
| `GET /v1/ohlc` | When `METALPRICEAPI_ENABLE_OHLC=true`, one call per output row (pair uses that row’s `base_currency`) |
| `GET /v1/symbols` | `symbols` |

This project builds the **`currencies`** query parameter from `metalprice_api_symbols_v1.enabled_for_pricing`.

### Daily timing note

MetalpriceAPI describes **prior-day** historical data as available from **00:05 GMT**. The included GitHub Action schedules **daily** at **`0 4 * * *` = 04:00 UTC** so `/v1/yesterday` is still populated hours later, while avoiding heavier global workflow load around **00:00 UTC**. GitHub `cron` is **UTC-only**. Adjust **`daily-etl.yml`** if your provider window differs.

## Configuration

Read from the environment (see `.env.example`):

| Variable | Purpose |
|----------|---------|
| `METALPRICEAPI_API_KEY` | API key |
| `METALPRICEAPI_BASE_URL` | Default `https://api.metalpriceapi.com` (include `https://`) |
| `METALPRICEAPI_BASE_CURRENCIES` | Comma-separated bases (e.g. `USD,CAD,AUD,EUR,GBP`). One MetalpriceAPI spot request per base per run. Default when unset: **`USD`** only. |
| `METALPRICEAPI_ENABLE_OHLC` | `true` / `false` (or `1` / `0`). When `false`, skips **`GET /v1/ohlc`**; **`open_base` … `close_base`** stay null. Default: **`false`**. |
| `SUPABASE_URL` | Project URL (no `/rest/v1/` suffix) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side Supabase key (JWT **`service_role`** or newer **`sb_secret_…`** key; CI: GitHub Secret only) |
| `SUPABASE_SCHEMA` | Default `xaulytics` |
| `SUPABASE_METAL_PRICES_TABLE` | Default `metal_prices_v1` |
| `SUPABASE_ETL_RUNS_TABLE` | Default `etl_runs_v1` |
| `SUPABASE_SYMBOLS_TABLE` | Default `metalprice_api_symbols_v1` |
| `LOG_LEVEL` | Default `INFO` |
| `RETENTION_ANCHOR_YEARS` | Calendar years before global max **`pricing_date`** to retain **`metal_prices_v1`** history from (`xaulytics-etl retention`). Default **5** when unset. Rows strictly older than the cutoff date are deleted. |

## Data model (schema `xaulytics`)

### `metal_prices_v1`

Normalized rates: composite primary key **`(pricing_date, quote_code, base_currency)`** so the same symbol can exist for USD, CAD, etc. **`DELETE`** is granted to **`service_role`** so **`xaulytics-etl retention`** can prune old rows while preserving calendar anchors used by the dashboard (including **5y**). **`price_base`** holds **`1 / quote_per_base`** from the spot endpoints — interpret as **price in `base_currency` units** per unit of quote. **`open_base`**, **`high_base`**, **`low_base`**, **`close_base`** are OHLC from **`GET /v1/ohlc`** in the same **spot base** as the row (e.g. CAD when `base_currency` is CAD), when **`METALPRICEAPI_ENABLE_OHLC`** is true and the request succeeds (one OHLC call per output row). Also includes optional `unit`, `source_endpoint`, `source_timestamp`, `ingested_at_utc`.

### `etl_runs_v1`

One row per run: `run_id`, **`mode`** (`daily`, `historical_manual`, `symbols_catalog`), optional requested date range, `status`, `row_count`, `error_message`, timestamps.

### `metalprice_api_symbols_v1`

Catalog from `GET /v1/symbols`. Important column: **`enabled_for_pricing`** — drives `currencies` for pricing endpoints. Stable view: `metalprice_api_symbols_current`.

Views **`metal_prices_current`**, **`etl_runs_current`**, **`metalprice_api_symbols_current`** mirror versioned tables for stable downstream naming. **`metal_prices_current`** and **`metalprice_api_symbols_current`** use **`security_invoker`** so queries respect the caller’s privileges (typical browser calls use the **`anon`** role).

## Docker

```bash
docker build -t xaulytics-etl:latest .
docker run --rm --env-file .env xaulytics-etl:latest daily
docker run --rm --env-file .env xaulytics-etl:latest historical --start-date 2026-04-01 --end-date 2026-04-05
docker run --rm --env-file .env xaulytics-etl:latest symbols
docker run --rm --env-file .env xaulytics-etl:latest retention
docker run --rm --env-file .env xaulytics-etl:latest retention --dry-run
```

## GitHub Actions

| Workflow | Purpose |
|----------|---------|
| `daily-etl.yml` | Cron schedule + **workflow_dispatch**: builds the Docker image, runs `symbols` and `daily` via `docker run`, then runs a **`retention-prices`** job (**`needs`** the daily job) that builds again and runs **`xaulytics-etl retention`** |
| `historical-etl.yml` | Manual: inputs `start_date` / `end_date` (`YYYY-MM-DD`), validates ISO dates, builds the Docker image, then runs `symbols` + `historical` via `docker run` |
| `ci.yml` | Manual `pytest` (Python 3.12) |
| `deploy-dashboard-pages.yml` | Push to `main` (dashboard paths) or manual dispatch: generates `dashboard/config.js` from `dashboard/config.example.js` via Python, uploads `dashboard/` as the Pages artifact root, deploys GitHub Pages |

**Secrets** (GitHub **Settings → Secrets and variables**): `METALPRICEAPI_API_KEY`, `METALPRICEAPI_BASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DASHBOARD_SUPABASE_URL`, `DASHBOARD_SUPABASE_ANON_KEY`.

**Workflow environment** (set in each YAML file, not secrets): `daily-etl.yml` and `historical-etl.yml` define **`METALPRICEAPI_BASE_CURRENCIES`** and **`METALPRICEAPI_ENABLE_OHLC`** (for example five bases and OHLC on or off). Edit the workflow file to change scheduled behavior; values in `.env.example` apply to local runs only.

`daily-etl.yml` and `historical-etl.yml` pass secrets and configuration into containers at runtime (`docker run --env ...`); secrets are not baked into the image.

### Run CI from GitHub

**Actions** → **CI** → **Run workflow**.

### Run historical ETL from GitHub

**Actions** → **Historical ETL (Manual)** → **Run workflow** → set `start_date` and `end_date` (`YYYY-MM-DD`).

## Tests

```bash
pip install -e ".[dev]"
pytest -q tests
```

This matches the **CI** workflow (`pip install -e .[dev]` then `pytest -q tests`). CI runs on **workflow_dispatch** only (not on every push).

## Dashboard (web)

Static assets under **`dashboard/`** (open via **`dashboard/serve.py`** or any static host). The UI uses the Supabase JS client with your **publishable / anon** key; it **does not** call MetalpriceAPI. The page includes required MetalpriceAPI **attribution** for derived data.

- **Base currency** dropdown (`baseCurrencies` in config); reloads cards and charts from **`metal_prices_*`** for the selected **`base_currency`**
- Cards for configurable **`preciousMetals`** (default `XAU`, `XAG`, `XPT`, `XPD`, `XRH`). Quote codes are normalized from config (invalid entries are dropped).
- **`display_name`** from **`metalprice_api_symbols_current`** when the catalog has a row (sync with **`xaulytics-etl symbols`**)
- Card title uses **`display_name (SYMBOL)`** when available (fallback: symbol only)
- Latest **spot**, **bid**, **ask**, **spread** for the **same `pricing_date`** on all cards (bid/ask need enabled symbols such as `XAU-BID` / `XAU-ASK`)
- **Spot change** vs the previous **`pricing_date`** returned for the **first** symbol in **`preciousMetals`** (default **`XAU`**): latest and prior dates are shared across cards for that comparison
- Click a card for trend chart + recent history table (history table **Δ** compares each date to the chronologically previous date **that has data** for that metal)

### Responsive / adaptive behavior

- Desktop/tablet keep full table and card density; mobile applies denser card sizing and layout tuned for touch.
- Main metal cards use **2 columns** on smaller phones and **3 columns** on wider phones in the mobile breakpoint.
- The detail history table switches to **stacked row cards** on mobile (label/value lines), while keeping a standard table on larger screens.
- Mobile stacked history rows colorize **Daily Change** and **Daily Change %** values with the same positive/negative semantics as desktop.
- Trend chart options are recomputed when crossing the mobile breakpoint so legend/tick sizing stays readable after resize/orientation changes.

### Spot performance table

Shown for the selected metal. Uses **spot** rows only (same **`quote_code`** as the metal; bid/ask rows are not mixed into these returns).

| Row | Meaning |
|-----|---------|
| **Today** | Latest spot in the loaded series vs the prior calendar row in that series (last vs second-to-last **`pricing_date`** for spot). |
| **YTD** | Spot on **January 1** of the **same calendar year as the latest spot date**, vs latest — **exact date match only** (no nearest-day fallback). |
| **1 month / 6 months** | Spot on the **same calendar day** one month or six months earlier (UTC `Date` math), vs latest — exact **`pricing_date`** match only. |
| **1 year / 5 years** | Spot on the **same calendar day** one or five **calendar years** earlier (UTC), vs latest — exact match only. |

If the anchor calendar day has no spot row for that metal and base, the cell shows **N/A**. Because PostgREST responses are often capped (commonly **~1000 rows** per request unless raised in Supabase), the dashboard loads **rolling recent spot rows** for the “Today” chain **and** runs a **second query** that fetches those **exact anchor dates** by `pricing_date`, so long horizons (e.g. five years back) still resolve when the data exists in the database.

Optional **`performanceSpotRowLimit`** in **`dashboard/config.js`** caps how many recent spot rows are requested for the rolling series (default **5000** in **`config.example.js`**); it does **not** replace the anchor-date query above.

### Dashboard setup

1. Copy **`dashboard/config.example.js`** to **`dashboard/config.js`** (ignored by git).
2. Set at minimum:
   - **`supabaseUrl`**
   - **`supabaseAnonKey`** (publishable / anon only — never the service role secret in the browser)
   - **`schema`** (default `xaulytics`)
   - **`baseCurrency`** (default `USD`)
3. Optional overrides (see **`config.example.js`**): **`pricesRelation`** (default **`metal_prices_current`**), **`symbolsRelation`** (default **`metalprice_api_symbols_current`**), **`baseCurrencies`** (header dropdown; bases must exist in DB from your ETL), **`preciousMetals`**, **`historyDays`**, **`performanceSpotRowLimit`** (max recent spot rows for the performance table rolling fetch; default **5000**).

   Invalid **`supabaseUrl`** / placeholder anon keys are rejected at startup (HTTPS required except **localhost** / **127.0.0.1** / **`[::1]`**). **`schema`** and relation names must be plain Postgres identifiers (letters, digits, underscore).
4. From the repo root, run the local static server and open the printed URL:

   ```bash
   python dashboard/serve.py
   ```

   Options: **`--port`** / **`-p`**, **`--bind`** / **`-b`** (e.g. `0.0.0.0`). Opening **`index.html`** via **`file://`** may work but serving avoids common browser restrictions.

### Dashboard deployment (GitHub Pages)

1. In GitHub repository settings, set **Pages → Source** to **GitHub Actions**.
2. Set repository secrets:
   - **`DASHBOARD_SUPABASE_URL`**
   - **`DASHBOARD_SUPABASE_ANON_KEY`** (publishable / anon key only)
3. The workflow **`deploy-dashboard-pages.yml`** generates **`dashboard/config.js`** from **`dashboard/config.example.js`** using a Python step, replacing `supabaseUrl` and `supabaseAnonKey` from those secrets.
4. The workflow uploads **`dashboard/`** as the Pages artifact root, so the project site URL resolves to:
   - **`https://bmoler68.github.io/XAUlytics`**

### Data expectations

- Enable bid/ask symbols in **`metalprice_api_symbols_v1`** when you want spread rows (e.g. `XAU-BID`, `XAU-ASK`; **`XRH`** often has spot only).
- **Permissions:** **`sql/schema.sql`** grants **`anon` / `authenticated`** **`USAGE`** on **`xaulytics`** and **`SELECT`** on **`metal_prices_v1`**, **`metal_prices_current`**, **`metalprice_api_symbols_v1`**, and **`metalprice_api_symbols_current`**. After **`DROP VIEW`** / **`CREATE VIEW`**, re-run that **`GRANT`** block from **`sql/schema.sql`** if you see **`permission denied for view …`**. Missing **`USAGE`** on the schema surfaces as **`permission denied for schema xaulytics`**.
- **`pricesRelation`** defaults to **`metal_prices_current`**; if that view is stale, recreate it from **`sql/schema.sql`** or point **`pricesRelation`** at **`metal_prices_v1`** temporarily.
- **Expose schema:** Supabase **Project Settings → Data API**: include **`xaulytics`** in **exposed schemas** so PostgREST serves the **`xaulytics`** tables/views.

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
