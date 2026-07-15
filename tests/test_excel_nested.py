"""PV (nested-block) parser against the real File 1 (skips if the workbook isn't committed).

The one rule that must never break for PV/3W/CV: **EV is not derivable.** The source has no
EV block — EV-only makers (e.g. Mahindra Electric) sit inline among ICE makers — so every
row is ``powertrain=all`` and there is never an ``ev`` row. A wrong EV number is worse than
no number.
"""

from __future__ import annotations

from collections import Counter
from datetime import date

from pipeline.contract.constants import INDUSTRY_TOTAL_CANONICAL
from pipeline.dictionaries.loader import load_company_resolver
from pipeline.validate.gates import GateContext, TotalsReconciliationGate


def test_every_pv_row_is_powertrain_all_never_ev(real_parse_pv) -> None:
    _, rows = real_parse_pv
    assert rows, "PV parse produced no rows"
    powertrains = {r.powertrain.value for r in rows}
    assert powertrains == {"all"}, f"PV must have no EV/ICE rows, got {powertrains}"


def test_ev_only_maker_is_ingested_inline_as_all(real_parse_pv) -> None:
    _, rows = real_parse_pv
    resolver = load_company_resolver()
    mahindra_ev = [r for r in rows if r.company_canonical == "Mahindra Electric Mobility"]
    assert mahindra_ev, "EV-only PV maker must still be ingested"
    # it is an EV-only company by attribute, but its rows are powertrain=all (never an EV total)
    assert resolver.is_ev_only("Mahindra Electric Mobility")
    assert all(r.powertrain.value == "all" for r in mahindra_ev)


def test_pv_flows_domestic_and_export_only(real_parse_pv) -> None:
    _, rows = real_parse_pv
    assert {r.flow.value for r in rows} == {"domestic", "export"}


def test_pv_segments_are_pc_uv_vans(real_parse_pv) -> None:
    _, rows = real_parse_pv
    seg = {r.segment for r in rows if r.company_canonical != INDUSTRY_TOTAL_CANONICAL}
    assert None not in seg, "company PV rows must carry a segment"
    assert seg <= {"PC", "UV", "Van"}, seg


def test_pv_industry_totals_ingested_as_reported(real_parse_pv) -> None:
    _, rows = real_parse_pv
    totals = [r for r in rows if r.company_canonical == INDUSTRY_TOTAL_CANONICAL]
    assert totals
    assert all(r.calc_status.value == "reported" and r.segment is None for r in totals)
    assert {r.flow.value for r in totals} == {"domestic", "export"}


def test_pv_zero_preserved_no_null_rows(real_parse_pv) -> None:
    _, rows = real_parse_pv
    assert all(r.value is not None for r in rows), "blank/'NA' cells are absence, not null rows"


def test_pv_industry_history_from_2012(real_parse_pv) -> None:
    _, rows = real_parse_pv
    industry = [r for r in rows if r.company_canonical == INDUSTRY_TOTAL_CANONICAL]
    assert min(r.period_date for r in industry) == date(2012, 4, 1)


def test_pv_quarter_reconciliation_no_overshoot(real_parse_pv) -> None:
    adapter, rows = real_parse_pv
    result = TotalsReconciliationGate().run(
        GateContext(rows=rows, extras={"reconciliation": adapter.reconciliation})
    )
    assert result.status.value == "pass"
    assert not result.details["overshoots"], "no maker set may exceed its reported PV total"


def test_pv_row_counts_stable(real_parse_pv) -> None:
    _, rows = real_parse_pv
    by_flow = Counter(r.flow.value for r in rows)
    assert by_flow["domestic"] > 0 and by_flow["export"] > 0
