from datetime import date

from xaulytics_etl.ohlc_params import build_ohlc_request_params


def test_ohlc_params_metal_uses_symbol_base_and_spot_quote() -> None:
    p = build_ohlc_request_params(date(2026, 4, 1), "XAU", "USD")
    assert p["base"] == "XAU"
    assert p["currency"] == "USD"
    assert p["date"] == "2026-04-01"


def test_ohlc_params_metal_non_usd_spot() -> None:
    p = build_ohlc_request_params(date(2026, 4, 1), "XAU", "CAD")
    assert p["base"] == "XAU"
    assert p["currency"] == "CAD"


def test_ohlc_params_forex_uses_spot_base() -> None:
    p = build_ohlc_request_params(date(2026, 4, 1), "EUR", "USD")
    assert p["base"] == "USD"
    assert p["currency"] == "EUR"


def test_ohlc_params_forex_non_usd_spot() -> None:
    p = build_ohlc_request_params(date(2026, 4, 1), "EUR", "GBP")
    assert p["base"] == "GBP"
    assert p["currency"] == "EUR"
