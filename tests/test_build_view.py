"""View-model builder: precomputed derived fields + the §4 data rules, on the fixture."""

from __future__ import annotations

from pipeline.build_view import build_view
from pipeline.contract.models import Bundle

META = {
    "generated_at": "2026-07-15T10:00:00+05:30",
    "source": "SIAM",
    "snapshot_id": None,
    "notes": "t",
}


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
    assert set(pt) >= {"v", "yoy", "share", "chg", "partial", "present", "expected", "revised"}


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
        val
        for flow in v["ev_penetration"].values()
        for pt in flow.values()
        for val in pt.values()
    ]
    assert leaves and all(val is None for val in leaves)
