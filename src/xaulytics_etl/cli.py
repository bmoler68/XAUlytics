from __future__ import annotations

import argparse
from datetime import date

from xaulytics_etl.etl import run_daily, run_historical, run_sync_symbols_catalog


def _parse_iso_date(value: str) -> date:
    return date.fromisoformat(value)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="xaulytics-etl",
        description="XAUlytics ETL for MetalpriceAPI to Supabase.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("daily", help="Run daily ETL for latest available rates.")

    subparsers.add_parser(
        "symbols",
        help="Sync supported symbol codes from MetalpriceAPI /v1/symbols (does not count toward API quota).",
    )

    historical_parser = subparsers.add_parser(
        "historical",
        help="Run manual historical ETL for one date or a date range.",
    )
    historical_parser.add_argument(
        "--start-date",
        required=True,
        type=_parse_iso_date,
        help="Start date in YYYY-MM-DD format.",
    )
    historical_parser.add_argument(
        "--end-date",
        required=False,
        type=_parse_iso_date,
        help="End date in YYYY-MM-DD format. Defaults to start date when omitted.",
    )

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    if args.command == "daily":
        run_daily()
        return

    if args.command == "symbols":
        run_sync_symbols_catalog()
        return

    if args.command == "historical":
        start_date: date = args.start_date
        end_date: date = args.end_date or args.start_date
        run_historical(start_date=start_date, end_date=end_date)
        return

    raise ValueError(f"Unsupported command: {args.command}")


if __name__ == "__main__":
    main()
