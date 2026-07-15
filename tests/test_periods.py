"""Fiscal calendar (Apr-Mar) + the inclusive-dimension guard."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from pipeline.aggregate.periods import (
    InclusiveDimensionError,
    aggregate_months_to_quarter,
    aggregate_months_to_year,
    assert_no_inclusive_overlap,
    assert_rows_single_basis,
    fiscal_quarter_index,
    fiscal_quarter_of,
    fiscal_quarter_start_date,
    fiscal_year_of,
    fiscal_year_start_date,
    months_of_fiscal_quarter,
)
from pipeline.contract.models import ContractRow

_IST = timezone(timedelta(hours=5, minutes=30))


def _month_row(d: date, value: float | None) -> ContractRow:
    return ContractRow(
        period_date=d,
        period_type="month",
        fiscal_year=fiscal_year_of(d),
        fiscal_quarter=fiscal_quarter_of(d),
        category="2W",
        segment="Scooter",
        sub_segment=None,
        company_canonical="Alpha Motors",
        company_raw="Alpha Motors",
        flow="domestic",
        powertrain="all",
        geography="IN",
        metric="units",
        value=value,
        unit="units",
        source="SIAM",
        source_file="f",
        source_period="2026-06",
        native_frequency="month",
        calc_status="reported",
        revision=0,
        ingest_date=datetime(2026, 7, 1, tzinfo=_IST),
        confidence="high",
        is_superseded=False,
        is_partial=False,
        periods_present=None,
        periods_expected=None,
    )


@pytest.mark.parametrize(
    "d,fy,fq",
    [
        (date(2026, 6, 1), "FY27", "Q1FY27"),  # user's example: Jun 2026 -> Q1 FY27
        (date(2026, 3, 31), "FY26", "Q4FY26"),  # last day of FY26
        (date(2026, 4, 1), "FY27", "Q1FY27"),  # first day of FY27 (boundary)
        (date(2025, 12, 31), "FY26", "Q3FY26"),
        (date(2026, 1, 1), "FY26", "Q4FY26"),  # Jan is Q4 of the SAME fiscal year
        (date(2024, 7, 1), "FY25", "Q2FY25"),
        (date(2025, 10, 15), "FY26", "Q3FY26"),
    ],
)
def test_fiscal_year_and_quarter(d: date, fy: str, fq: str) -> None:
    assert fiscal_year_of(d) == fy
    assert fiscal_quarter_of(d) == fq


def test_fiscal_year_boundary_flip() -> None:
    assert fiscal_year_of(date(2026, 3, 31)) != fiscal_year_of(date(2026, 4, 1))


@pytest.mark.parametrize(
    "d,idx",
    [
        (date(2026, 4, 1), 1),
        (date(2026, 6, 30), 1),
        (date(2026, 7, 1), 2),
        (date(2026, 10, 1), 3),
        (date(2026, 1, 1), 4),
        (date(2026, 3, 31), 4),
    ],
)
def test_fiscal_quarter_index(d: date, idx: int) -> None:
    assert fiscal_quarter_index(d) == idx


def test_months_of_fiscal_quarter() -> None:
    assert months_of_fiscal_quarter("Q1FY27") == (4, 5, 6)
    assert months_of_fiscal_quarter("Q2FY27") == (7, 8, 9)
    assert months_of_fiscal_quarter("Q3FY27") == (10, 11, 12)
    assert months_of_fiscal_quarter("Q4FY27") == (1, 2, 3)


# --- inclusive-dimension guard ---------------------------------------------------------


def test_powertrain_all_plus_ev_raises() -> None:
    with pytest.raises(InclusiveDimensionError):
        assert_no_inclusive_overlap("powertrain", ["all", "ev"])


def test_powertrain_ev_plus_ice_is_allowed() -> None:
    # ev and ice are disjoint (ice = all - ev) -> safe to hold together
    assert_no_inclusive_overlap("powertrain", ["ev", "ice"])


def test_flow_total_plus_domestic_raises() -> None:
    with pytest.raises(InclusiveDimensionError):
        assert_no_inclusive_overlap("flow", ["total", "domestic"])


def test_flow_domestic_plus_export_is_allowed() -> None:
    assert_no_inclusive_overlap("flow", ["domestic", "export"])


def test_unknown_dimension_is_noop() -> None:
    assert_no_inclusive_overlap("category", ["2W", "PV"])  # no rule -> no raise


def test_assert_rows_single_basis(bundle) -> None:
    ev_rows = [r for r in bundle.rows if r.powertrain.value == "ev"]
    ice_rows = [r for r in bundle.rows if r.powertrain.value == "ice"]
    all_rows = [r for r in bundle.rows if r.powertrain.value == "all"]
    # ev + ice together is fine
    assert_rows_single_basis(ev_rows[:1] + ice_rows[:1])
    # all + ev together double-counts -> must raise
    with pytest.raises(InclusiveDimensionError):
        assert_rows_single_basis(all_rows[:1] + ev_rows[:1])


def test_fiscal_period_start_dates() -> None:
    assert fiscal_quarter_start_date("Q1FY27") == date(2026, 4, 1)
    assert fiscal_quarter_start_date("Q4FY27") == date(2027, 1, 1)
    assert fiscal_year_start_date("FY27") == date(2026, 4, 1)


def test_aggregate_full_quarter() -> None:
    rows = [
        _month_row(date(2026, 4, 1), 100.0),
        _month_row(date(2026, 5, 1), 110.0),
        _month_row(date(2026, 6, 1), 120.0),
    ]
    q = aggregate_months_to_quarter(rows, "Q1FY27")
    assert q is not None
    assert q.period_type.value == "quarter" and q.fiscal_quarter == "Q1FY27"
    assert q.period_date == date(2026, 4, 1)
    assert q.value == 330.0
    assert q.calc_status.value == "derived"
    assert q.is_partial is False and q.periods_present == 3 and q.periods_expected == 3


def test_aggregate_partial_quarter() -> None:
    rows = [
        _month_row(date(2026, 4, 1), 100.0),
        _month_row(date(2026, 5, 1), 110.0),
    ]  # only 2 of 3 months present
    q = aggregate_months_to_quarter(rows, "Q1FY27")
    assert q is not None
    assert q.value == 210.0
    assert q.is_partial is True and q.periods_present == 2 and q.periods_expected == 3
    assert q.confidence.value == "medium"


def test_aggregate_zero_month_is_counted_not_null() -> None:
    # a reported 0 month counts toward coverage and toward the sum (0 != absence)
    rows = [
        _month_row(date(2026, 4, 1), 0.0),
        _month_row(date(2026, 5, 1), 50.0),
        _month_row(date(2026, 6, 1), 50.0),
    ]
    q = aggregate_months_to_quarter(rows, "Q1FY27")
    assert q.value == 100.0 and q.periods_present == 3 and q.is_partial is False


def test_aggregate_empty_returns_none() -> None:
    assert aggregate_months_to_quarter([], "Q1FY27") is None
    assert aggregate_months_to_year([], "FY27") is None


def test_aggregate_year() -> None:
    rows = [_month_row(date(2026, mth, 1), 10.0) for mth in range(4, 13)]  # Apr..Dec = 9 months
    rows += [_month_row(date(2027, mth, 1), 10.0) for mth in range(1, 4)]  # Jan..Mar = 3 months
    y = aggregate_months_to_year(rows, "FY27")
    assert y is not None and y.period_type.value == "year"
    assert y.value == 120.0 and y.periods_present == 12 and y.is_partial is False
