"""Infer category and unit for MetalpriceAPI /v1/symbols codes (best-effort)."""
from __future__ import annotations

from xaulytics_etl.models import SymbolCatalogRecord

_ENERGY: dict[str, str] = {
    "BRENT": "per_barrel",
    "WTI": "per_barrel",
    "GASOLINE": "per_gallon",
    "NATURALGAS": "per_mmbtu",
}

_CRYPTO = frozenset(
    {
        "ADA",
        "BNB",
        "BTC",
        "DOGE",
        "DOT",
        "ETH",
        "LINK",
        "LTC",
        "SOL",
        "TRX",
        "USDC",
        "USDT",
        "XRP",
    }
)

_METALS = frozenset(
    {
        "ALU",
        "XCO",
        "XCU",
        "XGA",
        "XIN",
        "IRON",
        "XPB",
        "XLI",
        "XMO",
        "NI",
        "XND",
        "XSN",
        "XTE",
        "XU",
        "ZNC",
    }
)

_PRECIOUS_BASE = frozenset({"XAU", "XAG", "XPT", "XPD"})


def infer_category_and_unit(symbol_code: str) -> tuple[str, str | None]:
    code = symbol_code.strip().upper()
    if code in _ENERGY:
        return "energy", _ENERGY[code]
    if code in _CRYPTO:
        return "cryptocurrency", None
    if code in _METALS:
        return "metals", "ounce"
    if code == "XRH":
        return "precious_metals", "ounce"
    if code in _PRECIOUS_BASE:
        return "precious_metals", "troy_ounce"
    if len(code) > 4 and code[3] == "-":
        base = code[:3]
        suffix = code[4:]
        if base in _PRECIOUS_BASE and suffix in {"BID", "ASK"}:
            return "precious_metals", "troy_ounce"
        if code.startswith("XAU-") and suffix.isalpha() and suffix not in {"BID", "ASK"}:
            return "india_gold", "troy_ounce"
        if code.startswith("XAG-") and suffix.isalpha() and suffix not in {"BID", "ASK"}:
            return "india_silver", "troy_ounce"
    return "currency", None


def symbols_response_to_records(symbols: dict[str, str]) -> list[SymbolCatalogRecord]:
    records: list[SymbolCatalogRecord] = []
    for raw_code, raw_name in symbols.items():
        code = str(raw_code).strip()
        if not code:
            continue
        name = str(raw_name).strip() or code
        category, unit = infer_category_and_unit(code)
        records.append(
            SymbolCatalogRecord(
                symbol_code=code,
                display_name=name,
                category=category,
                unit=unit,
                enabled_for_pricing=False,
            )
        )
    records.sort(key=lambda row: row.symbol_code)
    return records
