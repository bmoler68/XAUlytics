from datetime import date

from xaulytics_etl.ohlc_params import build_ohlc_request_params


def test_ohlc_params_metal_uses_base_symbol_and_usd_quote() -> None:
    p = build_ohlc_request_params(date(2026, 4, 1), "XAU")
    assert p["base"] == "XAU"
    assert p["currency"] == "USD"
    assert p["date"] == "2026-04-01"


def test_ohlc_params_forex_uses_usd_base() -> None:
    p = build_ohlc_request_params(date(2026, 4, 1), "EUR")
    assert p["base"] == "USD"
    assert p["currency"] == "EUR"
    assert p["date"] == "2026-04-01"
