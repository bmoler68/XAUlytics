from __future__ import annotations

import logging
from datetime import date

from xaulytics_etl.config import load_settings
from xaulytics_etl.extract import MetalpriceApiClient
from xaulytics_etl.load import SupabaseLoader
from xaulytics_etl.logging_utils import configure_logging
from xaulytics_etl.transform import (
    normalize_historical_payload,
    normalize_latest_payload,
    normalize_timeframe_payload,
)

LOGGER = logging.getLogger(__name__)


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
    )

    run_id = loader.create_run_log(mode="daily", requested_start_date=None, requested_end_date=None)
    try:
        payload = client.get_latest_rates(base_currency="USD")
        records = normalize_latest_payload(payload)
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
    )

    run_id = loader.create_run_log(
        mode="historical_manual",
        requested_start_date=start_date.isoformat(),
        requested_end_date=end_date.isoformat(),
    )
    try:
        if start_date == end_date:
            payload = client.get_historical_date_rates(start_date, base_currency="USD")
            records = normalize_historical_payload(payload, endpoint_name="historical")
        else:
            payload = client.get_timeframe_rates(start_date=start_date, end_date=end_date, base_currency="USD")
            records = normalize_timeframe_payload(payload)
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
