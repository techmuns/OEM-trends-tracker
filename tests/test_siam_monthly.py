"""File 2 (monthly SIAM) adapter — extend-only, maker-level, aliases, is_partial."""

from __future__ import annotations

from collections import Counter
from datetime import date

from pipeline.aggregate.periods import aggregate_months_to_quarter
from pipeline.contract.constants import INDUSTRY_TOTAL_CANONICAL
from pipeline.dictionaries.loader import UnknownCompanyError, load_company_resolver


def test_extend_only_period_window(real_parse_f2) -> None:
    _, rows = real_parse_f2
    # extend-only: nothing before 2026-01 is ingested; File 2's own history stays out
    assert min(r.period_date for r in rows) == date(2026, 1, 1)
    assert max(r.period_date for r in rows) == date(2026, 5, 1)


def test_maker_level_no_segment_no_ev(real_parse_f2) -> None:
    _, rows = real_parse_f2
    assert all(r.segment is None for r in rows), "File 2 has no segment split"
    assert all(r.powertrain.value == "all" for r in rows), "File 2 has no EV/ICE split"


def test_flows_include_production(real_parse_f2) -> None:
    _, rows = real_parse_f2
    flows = Counter(r.flow.value for r in rows)
    assert flows["domestic"] and flows["export"] and flows["production"]
    # 2W production — a capability File 1 lacked — now exists for the 2026 extension
    assert any(r.flow.value == "production" for r in rows)


def test_makers_resolved_and_inactive_excluded(real_parse_f2) -> None:
    _, rows = real_parse_f2
    makers = {r.company_canonical for r in rows}
    assert INDUSTRY_TOTAL_CANONICAL in makers  # 'Industry' -> total sentinel
    assert "Others" in makers
    # active majors present via File-2 aliases
    for m in [
        "Hero MotoCorp",
        "Honda Motorcycle & Scooter India",
        "TVS Motor Company",
        "Bajaj Auto",
    ]:
        assert m in makers
    # defunct/inactive makers (all-zero in 2026) are omitted, not ingested as zeros
    assert "Maruti Udyog" not in makers and "Kinetic Motor" not in makers


def test_file2_aliases_resolve() -> None:
    r = load_company_resolver()
    assert r.resolve("HMSI") == "Honda Motorcycle & Scooter India"
    assert r.resolve("TVS Motor") == "TVS Motor Company"
    assert r.resolve("Suzuki Motorcycles") == "Suzuki Motorcycle India"
    assert r.resolve("Yamaha") == "India Yamaha Motor"
    assert r.resolve("Others") == "Others"


def test_active_unknown_maker_would_hard_fail() -> None:
    # the adapter's resolve path hard-fails on an unknown active maker
    r = load_company_resolver()
    try:
        r.resolve("Brand New Scooters Ltd")
        raise AssertionError("expected UnknownCompanyError")
    except UnknownCompanyError:
        pass


def test_seam_reference_populated(real_parse_f2) -> None:
    adapter, _ = real_parse_f2
    assert adapter.seam_reference, "overlap seam reference must be captured"
    industry = adapter.seam_reference.get((INDUSTRY_TOTAL_CANONICAL, "domestic"), {})
    assert industry.get(date(2025, 12, 1)) is not None


def test_q1fy27_is_partial(real_parse_f2) -> None:
    # File 2 ends May-2026, so Q1FY27 (Apr+May+Jun) has only 2 of 3 months -> partial
    _, rows = real_parse_f2
    hero_dom = [
        r for r in rows if r.company_canonical == "Hero MotoCorp" and r.flow.value == "domestic"
    ]
    q = aggregate_months_to_quarter(hero_dom, "Q1FY27")
    assert q is not None
    assert q.is_partial is True
    assert q.periods_present == 2 and q.periods_expected == 3


def test_parse_is_deterministic(real_parse_f2) -> None:
    adapter, rows = real_parse_f2
    rows2 = adapter.parse(adapter.fetch("2026-05"))
    assert len(rows) == len(rows2)
