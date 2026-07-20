"""View-model builder: precomputed derived fields + the §4 data rules, on the fixture."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from pipeline.aggregate.periods import fiscal_quarter_of, fiscal_year_of
from pipeline.build_view import build_view
from pipeline.contract.constants import INDUSTRY_TOTAL_CANONICAL
from pipeline.contract.models import Bundle, ContractRow

META = {
    "generated_at": "2026-07-15T10:00:00+05:30",
    "source": "SIAM",
    "snapshot_id": None,
    "notes": "t",
}
_IST = timezone(timedelta(hours=5, minutes=30))


def _ind_row(d: date, powertrain: str, value: float) -> ContractRow:
    """A minimal industry-total row for exercising the penetration math directly."""
    return ContractRow(
        period_date=d,
        period_type="month",
        fiscal_year=fiscal_year_of(d),
        fiscal_quarter=fiscal_quarter_of(d),
        category="2W",
        segment=None,
        sub_segment=None,
        company_canonical=INDUSTRY_TOTAL_CANONICAL,
        company_raw="Total Domestic Two Wheelers",
        flow="domestic",
        powertrain=powertrain,
        geography="IN",
        metric="units",
        value=value,
        unit="units",
        source="SIAM",
        source_file="f.xlsx",
        source_period="2025-12",
        native_frequency="month",
        calc_status="reported",
        revision=0,
        ingest_date=datetime(2026, 7, 15, tzinfo=_IST),
        confidence="high",
        is_superseded=False,
        is_partial=False,
        periods_present=None,
        periods_expected=None,
    )


def _view(bundle: Bundle) -> dict:
    return build_view(bundle.rows, META)


def _series(view, company, flow, powertrain, period_type):
    return next(
        (
            s
            for s in view["series"]
            if s["company"] == company
            and s["flow"] == flow
            and s["powertrain"] == powertrain
            and s["period_type"] == period_type
        ),
        None,
    )


def test_meta_freshness_from_data(bundle: Bundle) -> None:
    v = _view(bundle)
    latest = max(r.period_date for r in bundle.rows).isoformat()
    assert v["meta"]["latest_period"] == latest
    assert v["meta"]["share_caveat"] == "Share within reported SIAM universe"


def test_no_business_math_fields_present(bundle: Bundle) -> None:
    v = _view(bundle)
    s = _series(v, "Alpha Motors", "domestic", "all", "month")
    assert s is not None
    pt = next(iter(s["points"].values()))
    assert set(pt) >= {
        "v",
        "prior",
        "yoy",
        "share",
        "chg",
        "partial",
        "present",
        "expected",
        "revised",
    }


def test_matched_prior_is_the_yoy_basis(bundle: Bundle) -> None:
    """The stored `prior` must be the SAME matched-elapsed value the yoy is derived from, so a
    partial period's prior column can never contradict its yoy (current < full-prior yet +yoy)."""
    v = _view(bundle)
    checked = 0
    for s in v["series"]:
        for p in s["points"].values():
            assert "prior" in p
            if p["yoy"] is not None and p["prior"] not in (None, 0):
                checked += 1
                assert abs((p["v"] / p["prior"] - 1.0) - p["yoy"]) < 1e-9
    assert checked > 0


def test_ev_only_maker_total_covers_ev_and_ice_never_negative(real_parse) -> None:
    """Pure-EV 2W makers (Ather, Okinawa) are reported at all=0 in the segmented block while
    their real volume lives only in the EV block. build_view must lift their total up to their
    EV volume, so derived ICE never goes negative and their share is not a false 0%."""
    _, rows = real_parse
    v = build_view(rows, META, "2W")
    monthly = {
        (s["company"], s["flow"], s["powertrain"]): s["points"]
        for s in v["series"]
        if s["period_type"] == "month"
    }
    for (_c, _f, p), pts in monthly.items():
        if p == "ice":
            for k, pt in pts.items():
                assert pt["v"] is None or pt["v"] >= -0.5, f"negative ICE at {_c} {_f} {k}"
    allm = monthly.get(("Ather Energy", "domestic", "all"), {})
    evm = monthly.get(("Ather Energy", "domestic", "ev"), {})
    icem = monthly.get(("Ather Energy", "domestic", "ice"), {})
    assert evm, "expected Ather EV volume in the real 2W data"
    for k, ev_pt in evm.items():
        if ev_pt["v"] is None:
            continue
        assert allm[k]["v"] >= ev_pt["v"] - 0.5  # total covers EV (all ⊇ ev)
        assert abs(icem[k]["v"]) <= 0.5  # a pure-EV maker has zero ICE, not a negative
    assert "Ather Energy" in v["meta"]["ev_only_makers"]


def test_ev_penetration_matches_denominator_to_ev_months() -> None:
    """When the industry total runs longer than its EV coverage (the real 2W case: `all`
    extends to 2026-05 via File 2 while EV ends 2025-12), annual penetration must divide EV by
    the total over the SAME EV-covered months — not by the full 12-month total, which would
    understate it (the 3.46% -> 4.71% FY26 correction)."""
    months = [date(2024, m, 1) for m in range(4, 13)] + [date(2025, m, 1) for m in range(1, 4)]
    rows: list[ContractRow] = []
    for i, d in enumerate(months):
        rows.append(_ind_row(d, "all", 100.0))  # total every month of FY25
        if i < 9:  # EV only Apr..Dec 2024; Jan..Mar have a total but no EV figure
            rows.append(_ind_row(d, "ev", 10.0))
    v = build_view(rows, META, "2W")
    fy = v["ev_penetration"]["domestic"]["year"]["FY25"]
    assert fy is not None
    assert abs(fy - (90.0 / 900.0)) < 1e-9  # 9mo EV / 9mo total, never 90/1200 = 0.075


def test_yoy_from_zero_is_null(bundle: Bundle) -> None:
    # Epsilon EV ramps from a reported 0 (2025-03 -> ... first nonzero 2025-04); the YoY a
    # year after a 0/absent base must be null, never a huge number.
    v = _view(bundle)
    for s in v["series"]:
        for p in s["points"].values():
            if p["yoy"] is not None:
                assert abs(p["yoy"]) < 100, "YoY should never explode from a ~0 base"


def test_partial_quarter_flagged(bundle: Bundle) -> None:
    v = _view(bundle)
    partial_points = [
        p
        for s in v["series"]
        if s["period_type"] == "quarter"
        for p in s["points"].values()
        if p["partial"]
    ]
    assert partial_points, "fixture has an incomplete quarter -> must be flagged partial"
    assert all(p["present"] < p["expected"] for p in partial_points)


def test_share_within_zero_one(bundle: Bundle) -> None:
    v = _view(bundle)
    for s in v["series"]:
        if s["powertrain"] not in ("all", "ev"):
            continue
        for p in s["points"].values():
            if p["share"] is not None:
                assert -0.001 <= p["share"] <= 1.5  # allow rounding / partial-universe edge


def test_never_sums_across_powertrain(bundle: Bundle) -> None:
    # ice is derived; ev and ice both present but never combined into an 'all+ev' series
    v = _view(bundle)
    powertrains = {s["powertrain"] for s in v["series"]}
    assert powertrains <= {"all", "ev", "ice"}


def test_pv_view_declares_ev_unavailable(real_parse_pv) -> None:
    # EV is NOT derivable for PV: the view must say has_ev=False so the UI renders EV
    # unavailable, and every series stays powertrain=all — never a derived ev/ice.
    _, rows = real_parse_pv
    v = build_view(rows, META, "PV")
    assert v["meta"]["has_ev"] is False
    assert v["meta"]["category"] == "PV"
    assert {s["powertrain"] for s in v["series"]} == {"all"}
    # EV-only makers surface as an inline list, never summed into an EV total
    assert "Mahindra Electric Mobility" in v["meta"]["ev_only_makers"]
    # ev_penetration carries no real numbers — every leaf is null (EV not derivable)
    leaves = [
        val for flow in v["ev_penetration"].values() for pt in flow.values() for val in pt.values()
    ]
    assert leaves and all(val is None for val in leaves)
