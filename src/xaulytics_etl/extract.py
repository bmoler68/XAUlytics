from __future__ import annotations

from datetime import date
from typing import Any

import requests


class MetalpriceApiClient:
    def __init__(self, api_key: str, base_url: str, timeout_seconds: int = 30) -> None:
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._timeout_seconds = timeout_seconds
        self._session = requests.Session()

    def _get(self, path: str, params: dict[str, Any]) -> dict[str, Any]:
        request_params = {"api_key": self._api_key, **params}
        response = self._session.get(
            f"{self._base_url}{path}",
            params=request_params,
            timeout=self._timeout_seconds,
        )
        response.raise_for_status()
        payload = response.json()
        if not payload.get("success"):
            error = payload.get("error", {})
            raise RuntimeError(f"MetalpriceAPI request failed: {error}")
        return payload

    def get_symbols(self) -> dict[str, str]:
        payload = self._get("/v1/symbols", {})
        return payload.get("symbols", {})

    def get_latest_rates(self, base_currency: str = "USD", currencies: str | None = None) -> dict[str, Any]:
        params: dict[str, Any] = {"base": base_currency}
        if currencies:
            params["currencies"] = currencies
        return self._get("/v1/latest", params)

    def get_historical_date_rates(
        self,
        pricing_date: date,
        base_currency: str = "USD",
        currencies: str | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"base": base_currency}
        if currencies:
            params["currencies"] = currencies
        return self._get(f"/v1/{pricing_date.isoformat()}", params)

    def get_timeframe_rates(
        self,
        start_date: date,
        end_date: date,
        base_currency: str = "USD",
        currencies: str | None = None,
    ) -> dict[str, Any]:
        if end_date < start_date:
            raise ValueError("end_date must be on or after start_date")
        params: dict[str, Any] = {
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "base": base_currency,
        }
        if currencies:
            params["currencies"] = currencies
        return self._get("/v1/timeframe", params)
