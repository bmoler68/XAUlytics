from __future__ import annotations

import logging
from dataclasses import replace
from datetime import date

from xaulytics_etl.config import load_settings
from xaulytics_etl.extract import MetalpriceApiClient
from xaulytics_etl.load import SupabaseLoader
from xaulytics_etl.logging_utils import configure_logging
from xaulytics_etl.models import RateRecord
from xaulytics_etl.symbol_catalog import symbols_response_to_records
from xaulytics_etl.transform import normalize_historical_payload, normalize_timeframe_payload

LOGGER = logging.getLogger(__name__)


def _enrich_records_with_ohlc(client: MetalpriceApiClient, records: list[RateRecord]) -> list[RateRecord]:
    """Merge GET /v1/ohlc USD open/high/low/close into each row (spot fields unchanged)."""
    if not records:
        return records
    enriched: list[RateRecord] = []
    for record in records:
        pd = date.fromisoformat(record.pricing_date)
        try:
            o, h, l, c = client.get_ohlc_usd(pd, record.quote_code)
        except Exception as exc:
            LOGGER.warning(
                "OHLC fetch failed; row stored without open_usd/high_usd/low_usd/close_usd",
                extra={
                    "quote_code": record.quote_code,
                    "pricing_date": record.pricing_date,
                    "error": str(exc),
                },
            )
            enriched.append(record)
            continue
        enriched.append(
            replace(
                record,
                open_usd=o,
                high_usd=h,
                low_usd=l,
                close_usd=c,
                source_endpoint=f"{record.source_endpoint}+ohlc",
            )
        )
    return enriched


def _pricing_currencies_csv(loader: SupabaseLoader) -> str:
    codes = loader.fetch_pricing_enabled_symbol_codes()
    if not codes:
        raise ValueError(
            "No symbols have enabled_for_pricing=true in the symbol catalog table. "
            "Run `xaulytics-etl symbols`, then set enabled_for_pricing for the codes you want "
            "MetalpriceAPI to return (enable symbols in the catalog with enabled_for_pricing=true)."
        )
    return ",".join(codes)


def run_daily() -> int:
    settings = load_settings()
    configure_logging(settings.log_level)
    client = MetalpriceApiClient(settings.metalpriceapi_api_key, settings.metalpriceapi_base_url)
    loader = SupabaseLoader(
        supabase_url=settings.supabase_url,
        supabase_service_role_key=settings.supabase_service_role_key,
        schema=settings.supabase_schema,
        metal_prices_table=settings.supabase_metal_prices_table,
        etl_runs_table=settings.supabase_etl_runs_table,
        symbols_table=settings.supabase_symbols_table,
    )

    run_id = loader.create_run_log(mode="daily", requested_start_date=None, requested_end_date=None)
    try:
        currencies = _pricing_currencies_csv(loader)
        payload = client.get_yesterday_rates(base_currency="USD", currencies=currencies)
        records = normalize_historical_payload(payload, endpoint_name="yesterday")
        records = _enrich_records_with_ohlc(client, records)
        inserted_count = loader.upsert_rates(records)
        loader.complete_run_log(run_id, status="success", row_count=inserted_count)
        LOGGER.info("Daily ETL completed", extra={"run_id": run_id, "extra_data": {"rows": inserted_count}})
        return inserted_count
    except Exception as exc:
        loader.complete_run_log(run_id, status="failed", row_count=0, error_message=str(exc))
        LOGGER.exception("Daily ETL failed", extra={"run_id": run_id})
        raise


def run_historical(start_date: date, end_date: date) -> int:
    settings = load_settings()
    configure_logging(settings.log_level)
    client = MetalpriceApiClient(settings.metalpriceapi_api_key, settings.metalpriceapi_base_url)
    loader = SupabaseLoader(
        supabase_url=settings.supabase_url,
        supabase_service_role_key=settings.supabase_service_role_key,
        schema=settings.supabase_schema,
        metal_prices_table=settings.supabase_metal_prices_table,
        etl_runs_table=settings.supabase_etl_runs_table,
        symbols_table=settings.supabase_symbols_table,
    )

    run_id = loader.create_run_log(
        mode="historical_manual",
        requested_start_date=start_date.isoformat(),
        requested_end_date=end_date.isoformat(),
    )
    try:
        currencies = _pricing_currencies_csv(loader)
        if start_date == end_date:
            payload = client.get_historical_date_rates(start_date, base_currency="USD", currencies=currencies)
            records = normalize_historical_payload(payload, endpoint_name="historical")
        else:
            payload = client.get_timeframe_rates(
                start_date=start_date,
                end_date=end_date,
                base_currency="USD",
                currencies=currencies,
            )
            records = normalize_timeframe_payload(payload)
        records = _enrich_records_with_ohlc(client, records)
        inserted_count = loader.upsert_rates(records)
        loader.complete_run_log(run_id, status="success", row_count=inserted_count)
        LOGGER.info(
            "Historical ETL completed",
            extra={
                "run_id": run_id,
                "extra_data": {
                    "rows": inserted_count,
                    "start_date": start_date.isoformat(),
                    "end_date": end_date.isoformat(),
                },
            },
        )
        return inserted_count
    except Exception as exc:
        loader.complete_run_log(run_id, status="failed", row_count=0, error_message=str(exc))
        LOGGER.exception("Historical ETL failed", extra={"run_id": run_id})
        raise


def run_sync_symbols_catalog() -> int:
    """Fetch GET /v1/symbols and upsert into Supabase symbol catalog."""
    settings = load_settings()
    configure_logging(settings.log_level)
    client = MetalpriceApiClient(settings.metalpriceapi_api_key, settings.metalpriceapi_base_url)
    loader = SupabaseLoader(
        supabase_url=settings.supabase_url,
        supabase_service_role_key=settings.supabase_service_role_key,
        schema=settings.supabase_schema,
        metal_prices_table=settings.supabase_metal_prices_table,
        etl_runs_table=settings.supabase_etl_runs_table,
        symbols_table=settings.supabase_symbols_table,
    )

    run_id = loader.create_run_log(mode="symbols_catalog", requested_start_date=None, requested_end_date=None)
    try:
        symbols_map = client.get_symbols()
        enabled_codes = set(loader.fetch_pricing_enabled_symbol_codes())
        records = [
            replace(record, enabled_for_pricing=(record.symbol_code in enabled_codes))
            for record in symbols_response_to_records(symbols_map)
        ]
        row_count = loader.upsert_symbol_catalog(records)
        loader.complete_run_log(run_id, status="success", row_count=row_count)
        LOGGER.info(
            "Symbol catalog sync completed",
            extra={"run_id": run_id, "extra_data": {"rows": row_count}},
        )
        return row_count
    except Exception as exc:
        loader.complete_run_log(run_id, status="failed", row_count=0, error_message=str(exc))
        LOGGER.exception("Symbol catalog sync failed", extra={"run_id": run_id})
        raise
