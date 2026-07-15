"""source_seam_check gate: industry-total mismatch fails; maker diffs are reported."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from pipeline.contract.constants import INDUSTRY_TOTAL_CANONICAL
from pipeline.contract.models import ContractRow
from pipeline.validate.gates import GateContext, GateStatus, SourceSeamCheckGate

_IST = timezone(timedelta(hours=5, minutes=30))
OVERLAP = date(2025, 12, 1)


def _row(company: str, value: float, segment: str | None, flow: str = "domestic") -> ContractRow:
    return ContractRow(
        period_date=OVERLAP,
        period_type="month",
        fiscal_year="FY26",
        fiscal_quarter="Q3FY26",
        category="2W",
        segment=segment,
        sub_segment=None,
        company_canonical=company,
        company_raw=company,
        flow=flow,
        powertrain="all",
        geography="IN",
        metric="units",
        value=value,
        unit="units",
        source="SIAM",
        source_file="Auto_Database__Summary__-_Spark.xlsx",
        source_period="2025-12",
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


def _ctx(file1_rows, seam_reference):
    return GateContext(rows=file1_rows, extras={"seam_reference": seam_reference})


def test_industry_match_passes_maker_diffs_reported() -> None:
    file1 = [
        _row(INDUSTRY_TOTAL_CANONICAL, 1_540_000, segment=None),
        _row("Hero MotoCorp", 405_000, segment="Scooter"),
        _row("Hero MotoCorp", 100_000, segment="Motor cycles"),  # File1 Hero total = 505,000
    ]
    seam = {
        (INDUSTRY_TOTAL_CANONICAL, "domestic"): {OVERLAP: 1_540_100},  # within tolerance
        ("Hero MotoCorp", "domestic"): {OVERLAP: 520_000},  # +3% vs File1 -> reported only
    }
    res = SourceSeamCheckGate().run(_ctx(file1, seam))
    assert res.status is GateStatus.PASS
    assert res.details["maker_diff_count"] == 1
    assert res.details["max_maker_diff_pct"] > 0


def test_industry_mismatch_fails() -> None:
    file1 = [_row(INDUSTRY_TOTAL_CANONICAL, 1_540_000, segment=None)]
    seam = {(INDUSTRY_TOTAL_CANONICAL, "domestic"): {OVERLAP: 1_700_000}}  # ~10% off
    res = SourceSeamCheckGate().run(_ctx(file1, seam))
    assert res.status is GateStatus.FAIL
    assert res.details["industry_mismatches"]


def test_no_seam_reference_skips() -> None:
    res = SourceSeamCheckGate().run(GateContext(rows=[]))
    assert res.status is GateStatus.SKIP
