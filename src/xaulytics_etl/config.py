from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv


@dataclass(frozen=True)
class Settings:
    metalpriceapi_api_key: str
    metalpriceapi_base_url: str
    supabase_url: str
    supabase_service_role_key: str
    supabase_schema: str
    supabase_metal_prices_table: str
    supabase_etl_runs_table: str
    supabase_symbols_table: str
    log_level: str


def _required_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise ValueError(f"Missing required environment variable: {name}")
    return value


def load_settings() -> Settings:
    load_dotenv()
    return Settings(
        metalpriceapi_api_key=_required_env("METALPRICEAPI_API_KEY"),
        metalpriceapi_base_url=os.getenv("METALPRICEAPI_BASE_URL", "https://api.metalpriceapi.com"),
        supabase_url=_required_env("SUPABASE_URL"),
        supabase_service_role_key=_required_env("SUPABASE_SERVICE_ROLE_KEY"),
        supabase_schema=os.getenv("SUPABASE_SCHEMA", "xaulytics"),
        supabase_metal_prices_table=os.getenv("SUPABASE_METAL_PRICES_TABLE", "metal_prices_v1"),
        supabase_etl_runs_table=os.getenv("SUPABASE_ETL_RUNS_TABLE", "etl_runs_v1"),
        supabase_symbols_table=os.getenv("SUPABASE_SYMBOLS_TABLE", "metalprice_api_symbols_v1"),
        log_level=os.getenv("LOG_LEVEL", "INFO"),
    )
