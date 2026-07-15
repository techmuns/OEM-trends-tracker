"""CV (quarterly, multi-flow-region) parser against the real File 1.

CV is the quarterly-native category: quarters are the REPORTED base (never derived from
months), it has three flow regions (domestic/export/production) on one sheet, and the last
column ("4QFY26") is an unfinalized annual-minus-9M formula that resolves NEGATIVE — it must
be dropped, not ingested. EV is not derivable (electric-bus makers sit inline).
"""

from __future__ import annotations

from datetime import date

from pipeline.build_view import build_view
from pipeline.contract.constants import INDUSTRY_TOTAL_CANONICAL
from pipeline.dictionaries.loader import load_company_resolver
from pipeline.validate.gates import GateContext, TotalsReconciliationGate

META = {"generated_at": "2026-07-15T10:00:00+05:30", "source": "SIAM", "snapshot_id": None, "notes": None}


def test_cv_is_quarterly_reported_base(real_parse_cv) -> None:
    _, rows = real_parse_cv
    assert rows
    assert {r.period_type.value for r in rows} == {"quarter"}
    assert {r.native_frequency.value for r in rows} == {"quarter"}
    assert {r.calc_status.value for r in rows} == {"reported"}  # quarters are reported, not derived


def test_cv_three_flow_regions_including_production(real_parse_cv) -> None:
    _, rows = real_parse_cv
    assert {r.flow.value for r in rows} == {"domestic", "export", "production"}


def test_cv_four_leaf_segments(real_parse_cv) -> None:
    _, rows = real_parse_cv
    seg = {r.segment for r in rows if r.company_canonical != INDUSTRY_TOTAL_CANONICAL}
    assert seg == {"M&HCV Passenger", "M&HCV Goods", "LCV Passenger", "LCV Goods"}


def test_cv_every_row_is_powertrain_all(real_parse_cv) -> None:
    _, rows = real_parse_cv
    assert {r.powertrain.value for r in rows} == {"all"}


def test_cv_drops_unfinalized_negative_quarter(real_parse_cv) -> None:
    # 4QFY26 is an annual-minus-9M formula that resolves negative while the annual is blank.
    # It must be excluded; no reported quarter may be Q4FY26, and the industry total is never
    # negative.
    adapter, rows = real_parse_cv
    assert all(r.fiscal_quarter != "Q4FY26" for r in rows)
    assert any("Q4FY26" in w for w in adapter.warnings)
    ind = [r for r in rows if r.company_canonical == INDUSTRY_TOTAL_CANONICAL]
    assert ind and all(r.value >= 0 for r in ind), "a reported industry total can't be negative"
    # last real quarter is Q3FY26 (Oct-2025 start)
    assert max(r.period_date for r in rows) == date(2025, 10, 1)


def test_cv_ev_only_bus_makers_inline(real_parse_cv) -> None:
    _, rows = real_parse_cv
    resolver = load_company_resolver()
    for name in ("Olectra Greentech", "Switch Mobility", "PMI Electro Mobility"):
        maker_rows = [r for r in rows if r.company_canonical == name]
        assert maker_rows, f"{name} should be ingested"
        assert resolver.is_ev_only(name)
        assert all(r.powertrain.value == "all" for r in maker_rows)


def test_cv_reconciliation_passes(real_parse_cv) -> None:
    adapter, rows = real_parse_cv
    result = TotalsReconciliationGate().run(
        GateContext(rows=rows, extras={"reconciliation": adapter.reconciliation})
    )
    assert result.status.value == "pass"
    assert not result.details["overshoots"]


def test_cv_view_is_quarter_native_with_year_derived(real_parse_cv) -> None:
    _, rows = real_parse_cv
    v = build_view(rows, META, "CV")
    assert v["meta"]["native_frequency"] == "quarter"
    assert v["meta"]["has_ev"] is False
    assert v["meta"]["has_production"] is True
    assert v["periods"]["month"] == []  # no month level for a quarter-native category
    assert len(v["periods"]["quarter"]) > 0 and len(v["periods"]["year"]) > 0
    # year is derived by summing quarters; the running FY is partial (expected 4 quarters)
    ind_year = next(
        x
        for x in v["series"]
        if x["company"] == INDUSTRY_TOTAL_CANONICAL and x["flow"] == "domestic" and x["period_type"] == "year"
    )
    partial = [p for p in ind_year["points"].values() if p["partial"]]
    assert partial and all(p["expected"] == 4 for p in partial)
