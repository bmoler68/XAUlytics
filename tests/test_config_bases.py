from xaulytics_etl.env_parsing import parse_base_currencies


def test_parse_base_currencies_default_usd_when_empty() -> None:
    assert parse_base_currencies(None) == ("USD",)
    assert parse_base_currencies("") == ("USD",)
    assert parse_base_currencies("   ") == ("USD",)


def test_parse_base_currencies_order_and_dedupe() -> None:
    assert parse_base_currencies("USD,CAD,AUD,EUR,GBP") == ("USD", "CAD", "AUD", "EUR", "GBP")
    assert parse_base_currencies("USD, USD ,EUR,EUR") == ("USD", "EUR")
