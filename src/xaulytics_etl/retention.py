from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import date

from xaulytics_etl.config import load_settings
from xaulytics_etl.load import SupabaseLoader
from xaulytics_etl.logging_utils import configure_logging

LOGGER = logging.getLogger(__name__)


def subtract_calendar_years(d: date, years: int) -> date:
    """Same calendar day N years earlier (UTC calendar semantics). Feb 29 → Feb 28 in non-leap years."""
    if years < 0:
        raise ValueError("years must be non-negative")
    target_year = d.year - years
    try:
        return d.replace(year=target_year)
    except ValueError:
        # e.g. 2024-02-29 → 2019-02-28
        return date(target_year, 2, 28)


def _retention_anchor_years() -> int:
    raw = os.getenv("RETENTION_ANCHOR_YEARS", "10").strip()
    try:
        years = int(raw)
    except ValueError as exc:
        raise ValueError("RETENTION_ANCHOR_YEARS must be an integer") from exc
    if years < 1:
        raise ValueError("RETENTION_ANCHOR_YEARS must be >= 1")
    return years


@dataclass(frozen=True)
class RetentionResult:
    latest_pricing_date: date | None
    cutoff_date: date | None
    rows_matched: int
    dry_run: bool


def run_retention(*, dry_run: bool = False) -> RetentionResult:
    """
    Delete rows in metal_prices strictly before (global_max_pricing_date - N calendar years).

    N defaults to 10 (dashboard 10y spot performance anchor). Keeps the cutoff date and newer rows.
    """
    settings = load_settings()
    configure_logging(settings.log_level)
    anchor_years = _retention_anchor_years()

    loader = SupabaseLoader(
        supabase_url=settings.supabase_url,
        supabase_service_role_key=settings.supabase_service_role_key,
        schema=settings.supabase_schema,
        metal_prices_table=settings.supabase_metal_prices_table,
        etl_runs_table=settings.supabase_etl_runs_table,
        symbols_table=settings.supabase_symbols_table,
    )

    latest = loader.fetch_global_max_pricing_date()
    if latest is None:
        LOGGER.info("Retention skipped: no rows in %s.", settings.supabase_metal_prices_table)
        return RetentionResult(
            latest_pricing_date=None,
            cutoff_date=None,
            rows_matched=0,
            dry_run=dry_run,
        )

    cutoff = subtract_calendar_years(latest, anchor_years)
    count_before = loader.count_prices_strictly_before(cutoff)

    LOGGER.info(
        "Retention: global_max_pricing_date=%s anchor_years=%s cutoff=%s rows_strictly_before_cutoff=%s dry_run=%s",
        latest.isoformat(),
        anchor_years,
        cutoff.isoformat(),
        count_before,
        dry_run,
        extra={
            "latest_pricing_date": latest.isoformat(),
            "cutoff_date": cutoff.isoformat(),
            "rows_strictly_before_cutoff": count_before,
            "dry_run": dry_run,
        },
    )

    if count_before == 0:
        return RetentionResult(
            latest_pricing_date=latest,
            cutoff_date=cutoff,
            rows_matched=0,
            dry_run=dry_run,
        )

    if dry_run:
        return RetentionResult(
            latest_pricing_date=latest,
            cutoff_date=cutoff,
            rows_matched=count_before,
            dry_run=True,
        )

    loader.delete_prices_strictly_before(cutoff)
    LOGGER.info("Retention deleted %s rows older than cutoff %s.", count_before, cutoff.isoformat())
    return RetentionResult(
        latest_pricing_date=latest,
        cutoff_date=cutoff,
        rows_matched=count_before,
        dry_run=False,
    )
