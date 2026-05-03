"""Build MetalpriceAPI GET /v1/ohlc query params from a catalog quote code."""
from __future__ import annotations

from datetime import date
from typing import Any

from xaulytics_etl.symbol_catalog import infer_category_and_unit


def build_ohlc_request_params(pricing_date: date, quote_code: str) -> dict[str, Any]:
    """Return params for /v1/ohlc. Metals/commodities use base=<symbol>&currency=USD; forex uses base=USD&currency=<symbol>."""
    code = quote_code.strip().upper()
    category, _ = infer_category_and_unit(code)
    d = pricing_date.isoformat()
    if category == "currency":
        return {"base": "USD", "currency": code, "date": d}
    return {"base": code, "currency": "USD", "date": d}
