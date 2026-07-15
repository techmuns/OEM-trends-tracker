"""Excel parser against the real File 1 (skips if the workbook isn't committed).

Covers the Phase-1 'rules that will bite you': 0≠null, ragged starts, EV subset with null
segment, industry totals as reported, and 100% quarter reconciliation.
"""

from __future__ import annotations

from collections import Counter
from datetime import date

from pipeline.contract.constants import INDUSTRY_TOTAL_CANONICAL
from pipeline.validate.gates import GateContext, TotalsReconciliationGate


def test_row_counts_by_flow_powertrain(real_parse) -> None:
    _, rows = real_parse
    counts = Counter((r.flow.value, r.powertrain.value) for r in rows)
    assert counts[("domestic", "all")] == 2856
    assert counts[("domestic", "ev")] == 292
    assert counts[("export", "all")] == 2726
    assert counts[("export", "ev")] == 68


def test_ev_rows_have_null_segment_and_all_rows_are_segmented(real_parse) -> None:
    _, rows = real_parse
    for r in rows:
        if r.powertrain.value == "ev":
            assert r.segment is None, "EV block has no segment split"
        elif r.powertrain.value == "all" and r.company_canonical != INDUSTRY_TOTAL_CANONICAL:
            assert r.segment in {"Scooter", "Motor cycles", "Mopeds"}


def test_zero_is_preserved_and_no_null_rows(real_parse) -> None:
    _, rows = real_parse
    # 0 ≠ null: reported zeros are kept as rows; absence is simply a missing row (never null)
    assert all(r.value is not None for r in rows), "blank cells must be absence, not null rows"
    zeros = [r for r in rows if r.value == 0.0]
    assert zeros, "reported zeros must be preserved"


def test_ather_literal_zero_case(real_parse) -> None:
    _, rows = real_parse
    ather = [
        r
        for r in rows
        if r.company_canonical == "Ather Energy"
        and r.flow.value == "domestic"
        and r.powertrain.value == "all"
        and r.period_date == date(2023, 4, 1)
    ]
    assert ather and ather[0].value == 0.0, "Ather's Apr-2023 domestic cell is a literal 0"


def test_ragged_company_starts(real_parse) -> None:
    _, rows = real_parse
    companies = [r for r in rows if r.company_canonical != INDUSTRY_TOTAL_CANONICAL]
    industry = [r for r in rows if r.company_canonical == INDUSTRY_TOTAL_CANONICAL]
    # industry totals begin Apr-2012; company rows not before Apr-2014 (FY15) — no back-fill
    assert min(r.period_date for r in industry) == date(2012, 4, 1)
    assert min(r.period_date for r in companies) == date(2014, 4, 1)
    assert not any(r.period_date < date(2014, 4, 1) for r in companies)


def test_industry_totals_ingested_as_reported(real_parse) -> None:
    _, rows = real_parse
    totals = [r for r in rows if r.company_canonical == INDUSTRY_TOTAL_CANONICAL]
    assert totals
    assert all(r.calc_status.value == "reported" and r.segment is None for r in totals)
    assert {r.flow.value for r in totals} == {"domestic", "export"}


def test_quarter_reconciliation_is_perfect(real_parse) -> None:
    adapter, rows = real_parse
    result = TotalsReconciliationGate().run(
        GateContext(rows=rows, extras={"reconciliation": adapter.reconciliation})
    )
    assert result.status.value == "pass"
    d = result.details
    assert d["quarter_compared"] > 1000
    assert d["quarter_match"] == d["quarter_compared"], "derived quarters must match file-reported"
    assert not d["overshoots"], "no company set may exceed its reported total"
