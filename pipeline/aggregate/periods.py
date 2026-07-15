"""Fiscal-period helpers + aggregation signatures + the inclusive-dimension guard.

Two things are FULLY implemented in Phase 0 because they are pure, low-risk, and every
later phase depends on them being correct:
  1. The fiscal calendar (April–March; Q1 = Apr–Jun) — date -> FY / fiscal quarter.
  2. The inclusive-dimension guard — a hard assertion that refuses to sum across
     overlapping dimension values (powertrain all⊇ev; flow total⊇domestic+export).

The M→Q→Y aggregation itself is only a SIGNATURE here — the summing logic lands in
Phase 1. But its guard is real now so the interface it will fill is already safe.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date

from pipeline.contract.constants import INCLUSIVE_DIMENSIONS
from pipeline.contract.models import ContractRow

# --- Fiscal calendar (India: FY = April..March, Q1 = Apr-Jun) --------------------------

FISCAL_YEAR_START_MONTH = 4


def fiscal_year_of(d: date) -> str:
    """Return the fiscal-year label, e.g. date(2026,6,1) -> 'FY27' (Apr 2026 is in FY27).

    A month in Jan–Mar belongs to the FY that started the previous April; Apr–Dec belong
    to the FY that started this April. The label uses the ENDING calendar year's last two
    digits (FY27 spans Apr 2026 – Mar 2027).
    """
    ending_year = d.year + 1 if d.month >= FISCAL_YEAR_START_MONTH else d.year
    return f"FY{ending_year % 100:02d}"


def fiscal_quarter_of(d: date) -> str:
    """Return the fiscal-quarter label, e.g. date(2026,6,1) -> 'Q1FY27'.

    Q1 = Apr–Jun, Q2 = Jul–Sep, Q3 = Oct–Dec, Q4 = Jan–Mar.
    """
    # months since the start of the fiscal year (Apr=0 ... Mar=11)
    months_in = (d.month - FISCAL_YEAR_START_MONTH) % 12
    q = months_in // 3 + 1
    return f"Q{q}{fiscal_year_of(d)}"


def fiscal_quarter_index(d: date) -> int:
    """1..4 — the fiscal quarter number for a date (Q1 = Apr-Jun)."""
    return ((d.month - FISCAL_YEAR_START_MONTH) % 12) // 3 + 1


def months_of_fiscal_quarter(fiscal_quarter: str) -> tuple[int, int, int]:
    """Calendar month numbers (1..12) that make up a fiscal quarter label like 'Q1FY27'.

    Q1 -> (4,5,6), Q2 -> (7,8,9), Q3 -> (10,11,12), Q4 -> (1,2,3).
    """
    q = int(fiscal_quarter[1])
    start = (FISCAL_YEAR_START_MONTH - 1 + (q - 1) * 3) % 12 + 1
    m1 = start
    m2 = (start % 12) + 1
    m3 = (m2 % 12) + 1
    return (m1, m2, m3)


# --- Inclusive-dimension guard (hard assertion; raises, never warns) -------------------


class InclusiveDimensionError(ValueError):
    """Raised when an aggregation would sum across values where one contains another.

    Summing (e.g.) powertrain 'all' together with 'ev' double-counts, because 'all'
    already includes 'ev'. This is the single worst failure mode class after a bad share,
    so it raises rather than warns.
    """


def assert_no_inclusive_overlap(dimension: str, values: Sequence[str]) -> None:
    """Guard: the set of `values` for `dimension` must not mix a container with a member.

    Example: assert_no_inclusive_overlap('powertrain', ['all', 'ev']) raises;
             assert_no_inclusive_overlap('powertrain', ['ev', 'ice']) is fine.
    """
    rules = INCLUSIVE_DIMENSIONS.get(dimension)
    if not rules:
        return
    present = set(values)
    for container, members in rules.items():
        if container in present:
            clash = present.intersection(members)
            if clash:
                raise InclusiveDimensionError(
                    f"cannot aggregate {dimension}: '{container}' already includes "
                    f"{sorted(clash)} — summing them double-counts. Fix the aggregation "
                    f"to a single non-overlapping basis."
                )


def assert_rows_single_basis(rows: Sequence[ContractRow]) -> None:
    """Guard applied to a set of rows about to be summed: no inclusive overlap on the
    dimensions we know are inclusive (powertrain, flow)."""
    assert_no_inclusive_overlap("powertrain", [r.powertrain.value for r in rows])
    assert_no_inclusive_overlap("flow", [r.flow.value for r in rows])


# --- Aggregation signatures (implemented in Phase 1) -----------------------------------


def aggregate_months_to_quarter(rows: Sequence[ContractRow], fiscal_quarter: str) -> ContractRow:
    """Sum monthly rows into one derived quarterly row (calc_status='derived').

    Phase 1 will: filter to the quarter's three months, run `assert_rows_single_basis`,
    sum values (nulls handled per the 0≠null rule), and set is_partial /
    periods_present / periods_expected from how many of the 3 months are present.
    """
    raise NotImplementedError("aggregate_months_to_quarter is implemented in Phase 1.")


def aggregate_months_to_year(rows: Sequence[ContractRow], fiscal_year: str) -> ContractRow:
    """Sum 12 monthly rows (Apr..Mar) into one derived yearly row. See Phase 1 notes above."""
    raise NotImplementedError("aggregate_months_to_year is implemented in Phase 1.")
