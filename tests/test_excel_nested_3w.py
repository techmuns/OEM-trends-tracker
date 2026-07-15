"""3W (nested-block) parser against the real File 1 (skips if the workbook isn't committed).

3W is the second nested category and adds two wrinkles PV didn't have:
  * NO single "Total 3W" row — the industry total is the sum of the reported per-segment
    totals (Passenger total + Goods total for domestic). Still reported, never a maker-sum.
  * A documented source overshoot (export Passenger, May-2023) that is acknowledged, not
    failed.
As with PV, EV is NOT derivable — every row is powertrain=all.
"""

from __future__ import annotations

from datetime import date

from pipeline.build_view import build_view
from pipeline.contract.constants import INDUSTRY_TOTAL_CANONICAL
from pipeline.dictionaries.loader import load_company_resolver
from pipeline.validate.gates import GateContext, TotalsReconciliationGate

META = {"generated_at": "2026-07-15T10:00:00+05:30", "source": "SIAM", "snapshot_id": None, "notes": None}


def test_every_3w_row_is_powertrain_all(real_parse_3w) -> None:
    _, rows = real_parse_3w
    assert rows
    assert {r.powertrain.value for r in rows} == {"all"}


def test_3w_segments_passenger_and_goods(real_parse_3w) -> None:
    _, rows = real_parse_3w
    seg = {r.segment for r in rows if r.company_canonical != INDUSTRY_TOTAL_CANONICAL}
    assert seg == {"Passenger", "Goods"}


def test_3w_ev_only_makers_ingested_inline(real_parse_3w) -> None:
    _, rows = real_parse_3w
    resolver = load_company_resolver()
    for name in ("Mahindra Electric Mobility", "TI Clean Mobility", "Pinnacle Mobility Solutions"):
        maker_rows = [r for r in rows if r.company_canonical == name]
        assert maker_rows, f"{name} should be ingested"
        assert resolver.is_ev_only(name)
        assert all(r.powertrain.value == "all" for r in maker_rows)


def test_3w_industry_total_is_sum_of_reported_segments(real_parse_3w) -> None:
    # No "Total 3W" row exists; the industry total is emitted from the reported segment
    # totals (Passenger total + Goods total). Domestic Dec-2025 must equal their sum.
    _, rows = real_parse_3w
    ind = [
        r
        for r in rows
        if r.company_canonical == INDUSTRY_TOTAL_CANONICAL
        and r.flow.value == "domestic"
        and r.period_date == date(2025, 12, 1)
    ]
    # two industry rows for domestic Dec-2025 (Passenger + Goods segment totals)
    assert len(ind) == 2
    assert {r.segment for r in ind} == {"Passenger", "Goods"}
    assert sum(r.value for r in ind) == 60641.0


def test_3w_view_sums_industry_across_segments(real_parse_3w) -> None:
    _, rows = real_parse_3w
    v = build_view(rows, META, "3W")
    assert v["meta"]["has_ev"] is False
    s = next(
        x
        for x in v["series"]
        if x["company"] == INDUSTRY_TOTAL_CANONICAL
        and x["flow"] == "domestic"
        and x["period_type"] == "month"
    )
    # the two segment totals sum into one industry series (segment is not a view key)
    assert s["points"]["2025-12"]["v"] == 60641.0


def test_3w_reconciliation_acknowledges_known_overshoot(real_parse_3w) -> None:
    # The May-2023 export Passenger overshoot (TVS mis-key in the source) is documented in
    # KNOWN_SOURCE_OVERSHOOTS, so the gate passes and records it as acknowledged, not hard.
    adapter, rows = real_parse_3w
    result = TotalsReconciliationGate().run(
        GateContext(rows=rows, extras={"reconciliation": adapter.reconciliation})
    )
    assert result.status.value == "pass"
    assert not result.details["overshoots"], "no UNacknowledged overshoot may remain"
    assert len(result.details["acknowledged_overshoots"]) == 1


def test_3w_no_null_rows(real_parse_3w) -> None:
    _, rows = real_parse_3w
    assert all(r.value is not None for r in rows), "blank/'NA' cells are absence, not null rows"
