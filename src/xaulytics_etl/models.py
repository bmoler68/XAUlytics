from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RateRecord:
    pricing_date: str
    quote_code: str
    base_currency: str
    quote_per_base: float
    price_usd: float
    unit: str | None
    source_endpoint: str
    source_timestamp: int | None
    open_usd: float | None = None
    high_usd: float | None = None
    low_usd: float | None = None
    close_usd: float | None = None


@dataclass(frozen=True)
class SymbolCatalogRecord:
    symbol_code: str
    display_name: str
    category: str
    unit: str | None
    enabled_for_pricing: bool = False
