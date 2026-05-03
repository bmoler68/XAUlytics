from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from supabase import Client, create_client

from xaulytics_etl.models import RateRecord, SymbolCatalogRecord


class SupabaseLoader:
    def __init__(
        self,
        supabase_url: str,
        supabase_service_role_key: str,
        schema: str,
        metal_prices_table: str,
        etl_runs_table: str,
        symbols_table: str,
    ) -> None:
        self._client: Client = create_client(supabase_url, supabase_service_role_key)
        self._schema = schema
        self._metal_prices_table = metal_prices_table
        self._etl_runs_table = etl_runs_table
        self._symbols_table = symbols_table

    def create_run_log(self, mode: str, requested_start_date: str | None, requested_end_date: str | None) -> str:
        run_id = str(uuid4())
        payload = {
            "run_id": run_id,
            "mode": mode,
            "requested_start_date": requested_start_date,
            "requested_end_date": requested_end_date,
            "status": "started",
            "started_at_utc": datetime.now(timezone.utc).isoformat(),
        }
        self._client.schema(self._schema).table(self._etl_runs_table).insert(payload).execute()
        return run_id

    def fetch_pricing_enabled_symbol_codes(self) -> list[str]:
        response = (
            self._client.schema(self._schema)
            .table(self._symbols_table)
            .select("symbol_code")
            .eq("enabled_for_pricing", True)
            .execute()
        )
        rows = response.data or []
        codes = [str(row["symbol_code"]) for row in rows if row.get("symbol_code")]
        codes.sort()
        return codes

    def upsert_rates(self, records: list[RateRecord]) -> int:
        if not records:
            return 0
        payload = [self._rate_record_to_row(record) for record in records]
        self._client.schema(self._schema).table(self._metal_prices_table).upsert(
            payload,
            on_conflict="pricing_date,quote_code",
        ).execute()
        return len(payload)

    def upsert_symbol_catalog(self, records: list[SymbolCatalogRecord], batch_size: int = 200) -> int:
        if not records:
            return 0
        total = 0
        for offset in range(0, len(records), batch_size):
            batch = records[offset : offset + batch_size]
            payload = [self._symbol_record_to_row(record) for record in batch]
            self._client.schema(self._schema).table(self._symbols_table).upsert(
                payload,
                on_conflict="symbol_code",
            ).execute()
            total += len(payload)
        return total

    def complete_run_log(self, run_id: str, status: str, row_count: int, error_message: str | None = None) -> None:
        payload: dict[str, Any] = {
            "status": status,
            "row_count": row_count,
            "completed_at_utc": datetime.now(timezone.utc).isoformat(),
            "error_message": error_message,
        }
        self._client.schema(self._schema).table(self._etl_runs_table).update(payload).eq("run_id", run_id).execute()

    @staticmethod
    def _rate_record_to_row(record: RateRecord) -> dict[str, Any]:
        return {
            "pricing_date": record.pricing_date,
            "quote_code": record.quote_code,
            "base_currency": record.base_currency,
            "quote_per_base": record.quote_per_base,
            "price_usd": record.price_usd,
            "unit": record.unit,
            "source_endpoint": record.source_endpoint,
            "source_timestamp": record.source_timestamp,
            "open_usd": record.open_usd,
            "high_usd": record.high_usd,
            "low_usd": record.low_usd,
            "close_usd": record.close_usd,
            "ingested_at_utc": datetime.now(timezone.utc).isoformat(),
        }

    @staticmethod
    def _symbol_record_to_row(record: SymbolCatalogRecord) -> dict[str, Any]:
        return {
            "symbol_code": record.symbol_code,
            "display_name": record.display_name,
            "category": record.category,
            "unit": record.unit,
            "enabled_for_pricing": record.enabled_for_pricing,
            "source": "metalpriceapi.com/v1/symbols",
            "documented_at": datetime.now(timezone.utc).isoformat(),
        }
