"""Reconciliation reference data + pure reconcile functions.

The Excel adapter emits ingestable contract rows PLUS this reference data (the per-segment
`Total` rows, the industry totals, and the file's pre-computed quarterly columns) which we
never ingest but use to check ourselves:

  (a) company sum per segment  == the segment `Total` row
  (b) sum of segment totals     == `Total Domestic/Exports Two Wheelers`
  (c) our derived quarters       == the file's reported quarterly columns  (free correctness check)

Expected exceptions: before FY15, company rows don't exist yet but the reported total does,
so (a)/(b) legitimately diverge. That is flagged as a known exception, never a silent pass.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date

from pipeline.contract.constants import COMPANY_HISTORY_FLOOR, INDUSTRY_TOTAL_CANONICAL
from pipeline.contract.models import ContractRow

# series identity used to line up monthly rows with reported quarterly values
SeriesKey = tuple[str, str, str | None, str]  # (flow, powertrain, segment, company_canonical)
QuarterKey = tuple[int, str]  # (quarter_number 1..4, fiscal_year e.g. "FY13")

_FLOOR = date.fromisoformat(COMPANY_HISTORY_FLOOR)
_FILE_Q_RE = re.compile(r"^([1-4])QFY(\d{2})$")  # file format e.g. "1QFY13"

# floating tolerance for reconciliation equality (values are integer units, but the file's
# quarterly cells are formula-computed floats)
TOL = 0.5

# The reported segment/industry Totals include SIAM makers NOT individually listed in this
# workbook (e.g. Ola, Ampere, small EV brands), so Σlisted is legitimately LESS than the
# Total. That undershoot is expected and reported, never failed. Only an OVERSHOOT — Σlisted
# exceeding the Total beyond rounding — signals a real double-count and fails.
OVERSHOOT_ABS = 1000.0
OVERSHOOT_REL = 0.01


def parse_file_quarter(label: str) -> QuarterKey | None:
    """'1QFY13' -> (1, 'FY13'); returns None if not a quarter label."""
    m = _FILE_Q_RE.match(label.strip())
    if not m:
        return None
    return int(m.group(1)), f"FY{m.group(2)}"


@dataclass
class ReconciliationData:
    # (flow, segment) -> {month_date: value}   from per-segment Total rows (powertrain=all)
    segment_totals: dict[tuple[str, str], dict[date, float | None]] = field(default_factory=dict)
    # flow -> {month_date: value}              from "Total Domestic/Exports Two Wheelers"
    industry_totals: dict[str, dict[date, float | None]] = field(default_factory=dict)
    # flow -> {month_date: value}              from EV block Total
    ev_totals: dict[str, dict[date, float | None]] = field(default_factory=dict)
    # series -> {(q, fy): value}               file's reported quarterly columns
    reported_quarters: dict[SeriesKey, dict[QuarterKey, float | None]] = field(default_factory=dict)


@dataclass(frozen=True)
class Mismatch:
    kind: str
    detail: str


def _close(a: float | None, b: float | None) -> bool:
    if a is None or b is None:
        return a is b  # both None == match; one None == mismatch
    return abs(a - b) <= TOL


def _classify(kind: str, label: str, part: float, total: float, month: date) -> Mismatch | None:
    """Return a Mismatch if `part` vs `total` is notable, else None.

    Overshoot (part > total beyond rounding) is a hard error (double-count). Undershoot
    (part < total = unlisted makers) is an expected gap. Pre-FY15 is always expected.
    The caller sorts hard vs expected by inspecting `kind`.
    """
    gap = part - total
    tol = max(OVERSHOOT_ABS, OVERSHOOT_REL * abs(total))
    if gap > tol and month >= _FLOOR:
        return Mismatch(
            "overshoot", f"{label} {month}: Σ={part:.0f} EXCEEDS Total={total:.0f} by {gap:.0f}"
        )
    if gap < -TOL:  # undershoot: unlisted makers (or pre-FY15 absent companies)
        pct = (-gap / total * 100) if total else 0.0
        tag = "pre_fy15" if month < _FLOOR else "unlisted"
        return Mismatch(tag, f"{label} {month}: Σ={part:.0f} < Total={total:.0f} ({pct:.1f}% gap)")
    return None


def reconcile_segment_sums(
    rows: list[ContractRow],
    recon: ReconciliationData,
    known_overshoots: set[tuple[str, str | None, date]] | None = None,
) -> tuple[list[Mismatch], list[Mismatch]]:
    """(a) Σ company `all` rows per (flow, segment, month) vs the segment Total.

    Returns (hard_overshoots, expected_gaps). Companies are a subset of the reported
    segment total, so an undershoot is expected; only an overshoot is a hard error — unless
    it is a documented source overshoot (see KNOWN_SOURCE_OVERSHOOTS), which is acknowledged.
    """
    known = known_overshoots or set()
    sums: dict[tuple[str, str, date], float] = {}
    for r in rows:
        # sum the reported BASE rows (month for 2W/PV/3W, quarter for CV) — never derived
        # year rows, and never the reported industry total (which is not a maker).
        if (
            r.powertrain.value != "all"
            or r.segment is None
            or r.period_type.value == "year"
            or r.value is None
            or r.company_canonical == INDUSTRY_TOTAL_CANONICAL
        ):
            continue
        k = (r.flow.value, r.segment, r.period_date)
        sums[k] = sums.get(k, 0.0) + r.value

    hard: list[Mismatch] = []
    expected: list[Mismatch] = []
    for (flow, segment), monthly in recon.segment_totals.items():
        for month, total in monthly.items():
            if total is None:
                continue
            got = sums.get((flow, segment, month), 0.0)
            m = _classify("segment_sum", f"{flow}/{segment}", got, total, month)
            if m is None:
                continue
            if m.kind == "overshoot" and (flow, segment, month) in known:
                expected.append(Mismatch("acknowledged_overshoot", m.detail))
            elif m.kind == "overshoot":
                hard.append(m)
            else:
                expected.append(m)
    return hard, expected


def reconcile_industry_totals(
    recon: ReconciliationData,
    known_overshoots: set[tuple[str, str | None, date]] | None = None,
) -> tuple[list[Mismatch], list[Mismatch]]:
    """(b) Σ segment totals per (flow, month) vs the industry Total row.

    The industry Total is a reported figure that includes makers not broken out into the
    listed segments, so Σsegments <= industry Total; only an overshoot is a hard error —
    unless it is a documented source overshoot (see KNOWN_SOURCE_OVERSHOOTS).
    """
    known = known_overshoots or set()
    seg_sum: dict[tuple[str, date], float] = {}
    for (flow, _segment), monthly in recon.segment_totals.items():
        for month, val in monthly.items():
            if val is not None:
                seg_sum[(flow, month)] = seg_sum.get((flow, month), 0.0) + val

    hard: list[Mismatch] = []
    expected: list[Mismatch] = []
    for flow, monthly in recon.industry_totals.items():
        for month, total in monthly.items():
            if total is None:
                continue
            got = seg_sum.get((flow, month), 0.0)
            m = _classify("industry_total", f"{flow}", got, total, month)
            if m is None:
                continue
            if m.kind == "overshoot" and (flow, None, month) in known:
                expected.append(Mismatch("acknowledged_overshoot", m.detail))
            elif m.kind == "overshoot":
                hard.append(m)
            else:
                expected.append(m)
    return hard, expected


def series_key(r: ContractRow) -> SeriesKey:
    return (r.flow.value, r.powertrain.value, r.segment, r.company_canonical)


def reconcile_quarters(
    rows: list[ContractRow], recon: ReconciliationData
) -> tuple[int, int, list[Mismatch]]:
    """(c) Derive quarters from monthly rows and compare to the file's reported quarterly
    columns for the same series. Only fully-covered quarters (3 non-null months) are
    compared. Returns (matches, compared, mismatches)."""
    from pipeline.aggregate.periods import fiscal_quarter_index, fiscal_year_of

    # group monthly values by series and quarter
    grouped: dict[SeriesKey, dict[QuarterKey, list[float | None]]] = {}
    for r in rows:
        if r.period_type.value != "month":
            continue
        qk = (fiscal_quarter_index(r.period_date), fiscal_year_of(r.period_date))
        grouped.setdefault(series_key(r), {}).setdefault(qk, []).append(r.value)

    matches = 0
    compared = 0
    mism: list[Mismatch] = []
    for skey, quarters in grouped.items():
        reported = recon.reported_quarters.get(skey, {})
        for qk, vals in quarters.items():
            if qk not in reported:
                continue
            if len(vals) < 3 or any(v is None for v in vals):
                continue  # only compare fully-covered quarters
            derived = sum(v for v in vals if v is not None)
            compared += 1
            if _close(derived, reported[qk]):
                matches += 1
            else:
                mism.append(
                    Mismatch(
                        "quarter", f"{skey} {qk}: derived={derived} vs reported={reported[qk]}"
                    )
                )
    return matches, compared, mism
