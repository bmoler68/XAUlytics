from xaulytics_etl.transform import normalize_latest_payload, normalize_timeframe_payload


def test_normalize_latest_payload_filters_reciprocals_and_computes_price() -> None:
    payload = {
        "success": True,
        "base": "USD",
        "timestamp": 1714473600,
        "rates": {
            "XAU": 0.0005,
            "USDXAU": 2000.0,
            "EUR": 0.91,
        },
    }

    records = normalize_latest_payload(payload)
    quote_codes = {record.quote_code for record in records}

    assert "XAU" in quote_codes
    assert "EUR" in quote_codes
    assert "USDXAU" not in quote_codes

    xau_record = [record for record in records if record.quote_code == "XAU"][0]
    assert round(xau_record.price_usd, 2) == 2000.00
    assert xau_record.unit == "troy_ounce"


def test_normalize_timeframe_payload_expands_dates() -> None:
    payload = {
        "success": True,
        "base": "USD",
        "rates": {
            "2026-04-01": {"XAG": 0.04},
            "2026-04-02": {"XAG": 0.05},
        },
    }
    records = normalize_timeframe_payload(payload)
    assert len(records) == 2
    assert {record.pricing_date for record in records} == {"2026-04-01", "2026-04-02"}
