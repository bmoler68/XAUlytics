from xaulytics_etl.symbol_catalog import infer_category_and_unit, symbols_response_to_records


def test_infer_precious_and_bid_ask() -> None:
    assert infer_category_and_unit("XAU") == ("precious_metals", "troy_ounce")
    assert infer_category_and_unit("XAU-BID") == ("precious_metals", "troy_ounce")
    assert infer_category_and_unit("XRH") == ("precious_metals", "ounce")


def test_infer_india_and_metals() -> None:
    assert infer_category_and_unit("XAU-MUMB") == ("india_gold", "troy_ounce")
    assert infer_category_and_unit("XAG-PUNE") == ("india_silver", "troy_ounce")
    assert infer_category_and_unit("XCU") == ("metals", "ounce")


def test_symbols_response_to_records_sorts_and_maps() -> None:
    payload = {"ZAR": "South African Rand", "XAU": "Gold"}
    rows = symbols_response_to_records(payload)
    assert [row.symbol_code for row in rows] == ["XAU", "ZAR"]
    assert rows[0].display_name == "Gold"
    assert rows[0].category == "precious_metals"
    assert rows[0].enabled_for_pricing is False
