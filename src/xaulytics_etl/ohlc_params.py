"""Build MetalpriceAPI GET /v1/ohlc query params from a catalog quote code."""
from __future__ import annotations

from datetime import date
from typing import Any

from xaulytics_etl.symbol_catalog import infer_category_and_unit


def build_ohlc_request_params(
    pricing_date: date,
    quote_code: str,
    spot_base_currency: str,
) -> dict[str, Any]:
    """Return params for /v1/ohlc for the same spot base as the rate row.

    Metals: base=<symbol>&currency=<spot_base>. Forex-style quotes: base=<spot_base>&currency=<symbol>.
    OHLC open/high/low/close are in *spot_base* per pair semantics (e.g. CAD per troy oz when spot_base is CAD).
    """
    code = quote_code.strip().upper()
    spot_base = spot_base_currency.strip().upper()
    category, _ = infer_category_and_unit(code)
    d = pricing_date.isoformat()
    if category == "currency":
        return {"base": spot_base, "currency": code, "date": d}
    return {"base": code, "currency": spot_base, "date": d}
