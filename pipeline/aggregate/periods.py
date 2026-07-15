"""Fiscal-period helpers + aggregation signatures + the inclusive-dimension guard.

Contents:
  1. The fiscal calendar (April–March; Q1 = Apr–Jun) — date -> FY / fiscal quarter.
  2. The inclusive-dimension guard — a hard assertion that refuses to sum across
     overlapping dimension values (powertrain all⊇ev; flow total⊇domestic+export).
  3. M→Q→Y aggregation (Phase 1) — sums a single series' monthly rows into a derived
     quarter/year row, guarded and coverage-aware (is_partial / periods_present/expected).
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


def _fy_end_year(fiscal_year: str) -> int:
    """'FY27' -> 2027 (the calendar year the fiscal year ends in)."""
    return 2000 + int(fiscal_year[2:])


def fiscal_year_start_date(fiscal_year: str) -> date:
    """First day of a fiscal year, e.g. 'FY27' -> 2026-04-01."""
    return date(_fy_end_year(fiscal_year) - 1, FISCAL_YEAR_START_MONTH, 1)


def fiscal_quarter_start_date(fiscal_quarter: str) -> date:
    """First day of a fiscal quarter, e.g. 'Q1FY27' -> 2026-04-01, 'Q4FY27' -> 2027-01-01."""
    q = int(fiscal_quarter[1])
    fy = fiscal_quarter[2:]
    m1 = months_of_fiscal_quarter(fiscal_quarter)[0]
    # Q1-Q3 (Apr-Dec) fall in the year before the FY-end; Q4 (Jan-Mar) in the FY-end year.
    year = _fy_end_year(fy) if q == 4 else _fy_end_year(fy) - 1
    return date(year, m1, 1)


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


# --- Aggregation (M -> Q -> Y) ---------------------------------------------------------


def _derive_period(
    rows: Sequence[ContractRow],
    members: Sequence[ContractRow],
    *,
    period_type: str,
    period_date: date,
    fiscal_year: str,
    fiscal_quarter: str | None,
    periods_expected: int,
) -> ContractRow | None:
    """Build one derived aggregate row from `members` (monthly rows of a single series).

    Returns None if no member months are present. Sums non-null values; sets
    is_partial / periods_present / periods_expected from coverage. Confidence drops to
    'medium' for a partial period.
    """
    if not members:
        return None
    assert_rows_single_basis(members)  # never sum across all⊇ev or total⊇domestic+export
    present = [m for m in members if m.value is not None]
    periods_present = len(members)
    is_partial = periods_present < periods_expected
    value = float(sum(m.value for m in present)) if present else None
    template = members[0]
    data = template.model_dump()
    data.update(
        {
            "period_date": period_date,
            "period_type": period_type,
            "fiscal_year": fiscal_year,
            "fiscal_quarter": fiscal_quarter,
            "value": value,
            "calc_status": "derived",
            "is_partial": is_partial,
            "periods_present": periods_present,
            "periods_expected": periods_expected,
            "confidence": "medium" if is_partial else template.confidence.value,
        }
    )
    # re-validate so enum fields coerce from strings (model_copy(update=...) would not)
    return ContractRow.model_validate(data)


def aggregate_months_to_quarter(
    rows: Sequence[ContractRow], fiscal_quarter: str
) -> ContractRow | None:
    """Sum a single series' monthly rows into one derived quarterly row.

    `rows` must belong to one observation series. Filters to the target quarter's months,
    guards against inclusive-dimension overlap, and sums (0≠null preserved). is_partial is
    set when fewer than 3 months are present. Returns None if no month is present.
    """
    members = [
        r
        for r in rows
        if r.period_type.value == "month" and fiscal_quarter_of(r.period_date) == fiscal_quarter
    ]
    return _derive_period(
        rows,
        members,
        period_type="quarter",
        period_date=fiscal_quarter_start_date(fiscal_quarter),
        fiscal_year=fiscal_quarter[2:],
        fiscal_quarter=fiscal_quarter,
        periods_expected=3,
    )


def aggregate_months_to_year(rows: Sequence[ContractRow], fiscal_year: str) -> ContractRow | None:
    """Sum a single series' monthly rows (Apr..Mar) into one derived yearly row."""
    members = [
        r
        for r in rows
        if r.period_type.value == "month" and fiscal_year_of(r.period_date) == fiscal_year
    ]
    return _derive_period(
        rows,
        members,
        period_type="year",
        period_date=fiscal_year_start_date(fiscal_year),
        fiscal_year=fiscal_year,
        fiscal_quarter=None,
        periods_expected=12,
    )
