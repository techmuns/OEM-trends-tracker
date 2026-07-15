"""Fiscal calendar (Apr-Mar) + the inclusive-dimension guard."""

from __future__ import annotations

from datetime import date

import pytest

from pipeline.aggregate.periods import (
    InclusiveDimensionError,
    aggregate_months_to_quarter,
    aggregate_months_to_year,
    assert_no_inclusive_overlap,
    assert_rows_single_basis,
    fiscal_quarter_index,
    fiscal_quarter_of,
    fiscal_year_of,
    months_of_fiscal_quarter,
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


def test_aggregation_signatures_are_stubs() -> None:
    with pytest.raises(NotImplementedError):
        aggregate_months_to_quarter([], "Q1FY27")
    with pytest.raises(NotImplementedError):
        aggregate_months_to_year([], "FY27")
