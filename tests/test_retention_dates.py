from datetime import date

from xaulytics_etl.retention import subtract_calendar_years


def test_subtract_calendar_years_plain() -> None:
    assert subtract_calendar_years(date(2026, 5, 10), 5) == date(2021, 5, 10)


def test_subtract_calendar_years_feb_29_to_non_leap() -> None:
    assert subtract_calendar_years(date(2024, 2, 29), 5) == date(2019, 2, 28)


def test_subtract_calendar_years_one_year() -> None:
    assert subtract_calendar_years(date(2026, 3, 15), 1) == date(2025, 3, 15)
