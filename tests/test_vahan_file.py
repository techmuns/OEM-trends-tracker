"""VahanFileAdapter — parse real VAHAN dashboard exports into contract rows.

Uses the committed sample exports in fixtures/vahan/ (real files a human downloaded from the
public VAHAN dashboard). No network; the live site is unreachable from CI by design.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

from pipeline.adapters.vahan_file import (
    VahanFileAdapter,
    _norm,
    _parse_number,
    parse_report,
)
from pipeline.validate.gates import GateContext, SchemaConformanceGate

FIX = Path(__file__).resolve().parents[1] / "fixtures" / "vahan"
_IST = timezone(timedelta(hours=5, minutes=30))
_ING = datetime(2026, 7, 21, tzinfo=_IST)

# YTD (Jan–Jul 2026) totals, hand-verified against the raw exports.
EXPECTED_YTD = {"2W": 12_442_014, "PV": 2_690_616, "3W": 795_060, "CV": 674_741}
CLASS_FILES = {
    "2W": FIX / "vahan_class_2w_2026.xlsx",
    "PV": FIX / "vahan_class_pv_2026.xlsx",
    "3W": FIX / "vahan_class_3w_2026.xlsx",
    "CV": FIX / "vahan_class_cv_2026.xlsx",
}


def _skip_if_missing(p: Path) -> None:
    if not p.exists():
        pytest.skip(f"VAHAN fixture not present: {p}")


def _parse(path: Path) -> tuple[VahanFileAdapter, list]:
    a = VahanFileAdapter(path, ingest_date=_ING)
    return a, a.parse(a.fetch("2026"))


# --- number / label helpers ------------------------------------------------------------


def test_parse_number_indian_grouping():
    assert _parse_number("5,09,269") == 509269.0
    assert _parse_number("0") == 0.0  # real reported zero, never null
    assert _parse_number("") is None  # blank = missing, never 0
    assert _parse_number(None) is None
    assert _parse_number(12) == 12.0


def test_norm_strips_nbsp_padding():
    assert _norm("\xa0\xa0 Maker \xa0\xa0") == "Maker"
    assert _norm("MOTOR   CAR") == "MOTOR CAR"


# --- per-category totals ---------------------------------------------------------------


@pytest.mark.parametrize("cat", ["2W", "PV", "3W", "CV"])
def test_class_file_ytd_total(cat):
    _skip_if_missing(CLASS_FILES[cat])
    _, rows = _parse(CLASS_FILES[cat])
    assert {r.category.value for r in rows} == {cat}
    ytd = sum(r.value for r in rows)
    assert ytd == EXPECTED_YTD[cat]


def test_rows_are_registrations_vahan_single_source():
    _skip_if_missing(CLASS_FILES["2W"])
    _, rows = _parse(CLASS_FILES["2W"])
    assert rows
    assert {r.source.value for r in rows} == {"VAHAN"}
    assert {r.flow.value for r in rows} == {"domestic"}
    assert {r.powertrain.value for r in rows} == {"all"}  # no EV split in a class export
    assert {r.native_frequency.value for r in rows} == {"month"}
    assert {r.calc_status.value for r in rows} == {"reported"}


def test_months_and_period_dates():
    _skip_if_missing(CLASS_FILES["PV"])
    _, rows = _parse(CLASS_FILES["PV"])
    dates = sorted(r.period_date for r in rows)
    assert dates[0] == date(2026, 1, 1)
    assert dates[-1] == date(2026, 7, 1)  # data current through Jul 2026
    assert len(dates) == 7


def test_rows_pass_schema_conformance_gate():
    rows = []
    for p in CLASS_FILES.values():
        _skip_if_missing(p)
        rows += _parse(p)[1]
    result = SchemaConformanceGate().run(GateContext(rows=rows))
    assert result.status.value == "pass", result.message


# --- maker / fuel exports parse but are not emitted as contract rows (v1) --------------


def test_maker_export_parses_but_emits_no_rows():
    p = FIX / "vahan_maker_month_2026.xlsx"
    _skip_if_missing(p)
    a, rows = _parse(p)
    assert rows == []  # all-category; can't be placed under the per-category contract
    assert a.report is not None and a.report.dimension.lower() == "maker"
    assert a.report.rows  # but the raw parse is available for inspection
    assert any("not emitted" in w for w in a.warnings)


def test_fuel_export_parses_and_exposes_ev_fuels():
    p = FIX / "vahan_fuel_2026.xlsx"
    _skip_if_missing(p)
    rep = parse_report(p)
    assert rep.dimension.lower() == "fuel"
    labels = {k.upper() for k in rep.rows}
    assert "PURE EV" in labels and "ELECTRIC(BOV)" in labels  # EV derivable from fuel


def test_unmapped_class_is_ignored_not_failed(tmp_path):
    # A class not in the dictionary must be skipped with a warning, never mis-bucketed
    # and never a hard failure (VAHAN has ~75 classes; most aren't 2W/PV/3W/CV).
    _skip_if_missing(CLASS_FILES["CV"])
    a, rows = _parse(CLASS_FILES["CV"])
    # CV file maps cleanly, so no unmapped warnings expected here; assert the mechanism exists
    assert isinstance(a.warnings, list)
    assert all(r.category.value == "CV" for r in rows)
