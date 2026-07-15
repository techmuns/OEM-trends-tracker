"""Reconciliation classification: overshoot fails, undershoot (unlisted makers) is expected."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from pipeline.contract.models import ContractRow
from pipeline.validate.reconciliation import (
    ReconciliationData,
    reconcile_industry_totals,
    reconcile_quarters,
    reconcile_segment_sums,
)

_IST = timezone(timedelta(hours=5, minutes=30))
POST_FY15 = date(2020, 6, 1)  # a month well after the FY15 company floor


def _co_row(value: float, month: date = POST_FY15, segment: str = "Scooter") -> ContractRow:
    return ContractRow(
        period_date=month,
        period_type="month",
        fiscal_year="FY21",
        fiscal_quarter="Q1FY21",
        category="2W",
        segment=segment,
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
        source_period="2020-06",
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


def test_undershoot_is_expected_not_hard() -> None:
    rows = [_co_row(9000.0)]  # listed companies sum to 9000
    recon = ReconciliationData(segment_totals={("domestic", "Scooter"): {POST_FY15: 10000.0}})
    hard, expected = reconcile_segment_sums(rows, recon)
    assert not hard  # 9000 < 10000 -> unlisted makers, no hard error
    assert expected and expected[0].kind == "unlisted"


def test_overshoot_is_hard() -> None:
    rows = [_co_row(12000.0)]  # companies EXCEED the total -> double-count
    recon = ReconciliationData(segment_totals={("domestic", "Scooter"): {POST_FY15: 10000.0}})
    hard, _ = reconcile_segment_sums(rows, recon)
    assert hard and hard[0].kind == "overshoot"


def test_known_overshoot_is_acknowledged_not_hard() -> None:
    # A documented source overshoot is downgraded to an expected 'acknowledged_overshoot';
    # everything else still hard-fails, so the guard is not a blanket allow.
    rows = [_co_row(12000.0)]
    recon = ReconciliationData(segment_totals={("domestic", "Scooter"): {POST_FY15: 10000.0}})
    known = {("domestic", "Scooter", POST_FY15)}
    hard, expected = reconcile_segment_sums(rows, recon, known)
    assert not hard
    assert expected and expected[0].kind == "acknowledged_overshoot"
    # a different month is NOT acknowledged -> still hard
    hard2, _ = reconcile_segment_sums(rows, recon, {("domestic", "Scooter", date(1999, 1, 1))})
    assert hard2 and hard2[0].kind == "overshoot"


def test_pre_fy15_undershoot_tagged() -> None:
    old = date(2013, 6, 1)
    rows = [_co_row(0.0, month=old)]
    recon = ReconciliationData(segment_totals={("domestic", "Scooter"): {old: 10000.0}})
    hard, expected = reconcile_segment_sums(rows, recon)
    assert not hard and expected[0].kind == "pre_fy15"


def test_industry_undershoot_expected() -> None:
    recon = ReconciliationData(
        segment_totals={
            ("domestic", "Scooter"): {POST_FY15: 6000.0},
            ("domestic", "Motor cycles"): {POST_FY15: 3000.0},
        },
        industry_totals={"domestic": {POST_FY15: 10000.0}},  # 9000 < 10000
    )
    hard, expected = reconcile_industry_totals(recon)
    assert not hard and expected


def test_quarter_reconciliation_matches() -> None:
    months = [date(2020, 4, 1), date(2020, 5, 1), date(2020, 6, 1)]
    rows = [_co_row(100.0, month=m) for m in months]
    # file reports Q1FY21 = 300 for this series
    recon = ReconciliationData(
        reported_quarters={("domestic", "all", "Scooter", "Alpha Motors"): {(1, "FY21"): 300.0}}
    )
    match, compared, mism = reconcile_quarters(rows, recon)
    assert compared == 1 and match == 1 and not mism
