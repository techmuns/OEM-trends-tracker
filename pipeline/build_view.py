"""UI view-model builder — precompute everything the dashboard renders.

The frozen ContractRow cannot carry derived fields (yoy_pct, share, share_change_pp) and we
never edit schema.json. So this emits a SEPARATE presentation artifact —
``data/bundle/2w.json`` — a projection of the canonical store with all business math done
HERE, in Python, behind the same guards as the contract. The UI does zero math.

What it computes, per maker series (company × flow × powertrain × period_type):
  * maker-level values (File 1 segments summed up; File 2 already maker-level)
  * derived ICE = all − ev (never summed across powertrain)
  * Monthly base + materialized Quarterly / Yearly (with is_partial coverage)
  * yoy_pct (null from a 0 or null base — never ∞)
  * share within the reported universe of the SAME flow+powertrain+period (the guard)
  * share_change_pp (percentage points vs a year ago)
  * revised flag, partial coverage

Freshness is explicit in meta so the UI never hardcodes a date.
"""

from __future__ import annotations

import json
from collections import defaultdict
from collections.abc import Sequence
from datetime import date
from pathlib import Path

from pipeline.compute import yoy
from pipeline.contract.constants import (
    COMPANY_HISTORY_FLOOR,
    CONTRACT_VERSION,
    FILE1_LAST_PERIOD,
    INDUSTRY_TOTAL_CANONICAL,
    SIAM_UNIVERSE_LABEL,
    SOURCE_UNIVERSE_LABELS,
)
from pipeline.contract.models import ContractRow
from pipeline.dictionaries.loader import load_categories, load_company_resolver

BUNDLE_DIR = Path("data/bundle")
MANIFEST_PATH = BUNDLE_DIR / "categories.json"
MONTH, QUARTER, YEAR = "month", "quarter", "year"


def view_path(category: str) -> Path:
    return BUNDLE_DIR / f"{category.lower()}.json"


# --- period key + label helpers --------------------------------------------------------


def _fy(d: date) -> str:
    ey = d.year + 1 if d.month >= 4 else d.year
    return f"FY{ey % 100:02d}"


def _fq(d: date) -> str:
    q = ((d.month - 4) % 12) // 3 + 1
    return f"Q{q}{_fy(d)}"


def month_key(d: date) -> str:
    return d.strftime("%Y-%m")


def month_label(d: date) -> str:
    return d.strftime("%b '") + d.strftime("%y")


def quarter_label(fq: str) -> str:
    return f"{fq[:2]} {fq[2:]}"  # Q1FY27 -> "Q1 FY27"


def build_view(rows: Sequence[ContractRow], meta_src: dict, category: str = "2W") -> dict:
    # `category` is the VIEW/tab key (also the store + manifest key). It usually equals the
    # ContractRow.category dimension (2W/PV/3W/CV). A source that reuses a vehicle category
    # under a separate tab — e.g. VAHAN registrations for 2W — sets `row_category` in
    # categories.yaml so the view key ("VAHAN2W") stays distinct from the SIAM "2W" tab while
    # still filtering the right rows. Absent (every SIAM category), it defaults to `category`,
    # so SIAM output is byte-for-byte unchanged.
    cat_cfg = load_categories().get(category, {})
    row_cat = cat_cfg.get("row_category", category)
    rows = [r for r in rows if r.category.value == row_cat]
    if not rows:
        raise ValueError(f"no rows for category {category}")
    # Base frequency: 2W/PV/3W report monthly (quarter/year derived); CV reports quarterly
    # (quarter is the reported base, year derived from 4 quarters, no month level).
    base_pt = cat_cfg.get("native_frequency", MONTH)
    if base_pt == MONTH:
        pt_specs = [(MONTH, 1), (QUARTER, 3), (YEAR, 12)]
    else:  # quarter-native
        pt_specs = [(QUARTER, 1), (YEAR, 4)]
    current = [r for r in rows if not r.is_superseded and r.period_type.value == base_pt]
    # revised at maker grain: any superseded row for this (company, flow, powertrain, month)
    revised = {
        (r.company_canonical, r.flow.value, r.powertrain.value, r.period_date)
        for r in rows
        if r.is_superseded
    }

    # 1) maker-level monthly (File 1 segments summed up; File 2 already maker-level)
    mm: dict[tuple[str, str, str], dict[date, float]] = defaultdict(lambda: defaultdict(float))
    for r in current:
        if r.value is None:
            continue
        mm[(r.company_canonical, r.flow.value, r.powertrain.value)][r.period_date] += r.value

    # 2) industry EV = Σ maker ev; derived ICE = all − ev (industry and maker level)
    makers = {c for (c, _f, _p) in mm} - {INDUSTRY_TOTAL_CANONICAL}
    flows = {f for (_c, f, _p) in mm}
    for f in flows:
        # industry ev
        ind_ev: dict[date, float] = defaultdict(float)
        for c in makers:
            for d, v in mm.get((c, f, "ev"), {}).items():
                ind_ev[d] += v
        if ind_ev:
            mm[(INDUSTRY_TOTAL_CANONICAL, f, "ev")] = dict(ind_ev)
        # derived ice = all - ev, wherever both exist (maker + industry)
        for c in makers | {INDUSTRY_TOTAL_CANONICAL}:
            allm = mm.get((c, f, "all"))
            evm = mm.get((c, f, "ev"))
            if not allm or not evm:
                continue
            ice = {d: allm[d] - evm[d] for d in allm if d in evm}
            if ice:
                mm[(c, f, "ice")] = ice

    # 3) derive every period point with MATCHED-elapsed-months comparisons.
    #    A partial current period (e.g. Q1FY27 = Apr+May, no Jun) is compared to the SAME
    #    calendar months of the prior year (QTD vs QTD) — never a partial vs a full period.
    def matched_sum(series: dict[date, float], dates: list[date]) -> float | None:
        present = [d for d in dates if d in series]
        return sum(series[d] for d in present) if present else None

    def shift_year(d: date) -> date:
        return date(d.year - 1, d.month, 1)

    def group_periods(monthly: dict[date, float], pt: str) -> dict[str, list[date]]:
        groups: dict[str, list[date]] = defaultdict(list)
        for d in monthly:
            key = month_key(d) if pt == MONTH else (_fq(d) if pt == QUARTER else _fy(d))
            groups[key].append(d)
        return groups

    out_series = []
    for (c, f, p), monthly in mm.items():
        industry = mm.get((INDUSTRY_TOTAL_CANONICAL, f, p), {}) if p in ("all", "ev") else {}
        for pt, expected in pt_specs:
            pdata: dict[str, dict] = {}
            for key, dates in group_periods(monthly, pt).items():
                dates.sort()
                value = sum(monthly[d] for d in dates)
                prior_dates = [shift_year(d) for d in dates]
                prior = matched_sum(monthly, prior_dates)
                denom = matched_sum(industry, dates) if industry else None
                pdenom = matched_sum(industry, prior_dates) if industry else None
                share = (value / denom) if (denom not in (None, 0)) else None
                pshare = (
                    (prior / pdenom) if (prior is not None and pdenom not in (None, 0)) else None
                )
                pdata[key] = {
                    "v": value,
                    "yoy": yoy(value, prior),
                    "share": share,
                    "chg": (share - pshare) if (share is not None and pshare is not None) else None,
                    "partial": len(dates) < expected,
                    "present": len(dates),
                    "expected": expected,
                    "revised": any((c, f, p, d) in revised for d in dates),
                }
            out_series.append(
                {"company": c, "flow": f, "powertrain": p, "period_type": pt, "points": pdata}
            )

    # 4) EV penetration = industry ev / industry all, per (flow, period_type, period)
    ev_penetration: dict[str, dict[str, dict[str, float | None]]] = {}
    for f in flows:
        ind_all = mm.get((INDUSTRY_TOTAL_CANONICAL, f, "all"), {})
        ind_ev = mm.get((INDUSTRY_TOTAL_CANONICAL, f, "ev"), {})
        ev_penetration[f] = {}
        for pt in [p for p, _ in pt_specs]:
            m: dict[str, float | None] = {}
            for key, dates in group_periods(ind_all, pt).items():
                a = sum(ind_all[d] for d in dates)
                e = matched_sum(ind_ev, dates)
                m[key] = (e / a) if (e is not None and a) else None
            ev_penetration[f][pt] = m

    # 6) period axes (labels, sorted). all_dates are base-period start dates (months for
    #    2W/PV/3W, quarter-starts for CV); the month axis is empty for a quarter-native cat.
    all_months = sorted({d for m in mm.values() for d in m})
    periods = {
        MONTH: [
            {
                "key": month_key(d),
                "label": month_label(d),
                "date": d.isoformat(),
                "fiscal_year": _fy(d),
                "fiscal_quarter": _fq(d),
            }
            for d in all_months
        ]
        if base_pt == MONTH
        else [],
        QUARTER: _period_axis(all_months, QUARTER),
        YEAR: _period_axis(all_months, YEAR),
    }

    latest = all_months[-1]
    ev_months = sorted({d for (c, f, p), m in mm.items() if p == "ev" for d in m})
    prod_months = sorted({d for (c, f, p), m in mm.items() if f == "production" for d in m})
    resolver = load_company_resolver()
    has_ev = bool(ev_months)  # EV is only ever present where it is a derivable subset (2W)
    ev_only_makers = sorted(c for c in makers if resolver.is_ev_only(c))
    source = cat_cfg.get("source", meta_src.get("source", "SIAM"))
    universe = SOURCE_UNIVERSE_LABELS.get(source, SIAM_UNIVERSE_LABEL)
    return {
        "meta": {
            "contract_version": CONTRACT_VERSION,
            "generated_at": meta_src["generated_at"],
            "category": category,
            "category_label": cat_cfg.get("label", category),
            "source": source,
            "source_universe_label": universe,
            "share_caveat": universe,
            "coverage_start": all_months[0].isoformat(),
            "latest_period": latest.isoformat(),
            "native_frequency": cat_cfg.get("native_frequency", "month"),
            "has_ev": has_ev,
            "has_production": bool(prod_months),
            "ev_only_makers": ev_only_makers,  # inline EV-only makers (never an EV total)
            "ev_latest_period": ev_months[-1].isoformat() if ev_months else None,
            "production_first_period": prod_months[0].isoformat() if prod_months else None,
            "company_history_floor": COMPANY_HISTORY_FLOOR,
            "file1_last_period": FILE1_LAST_PERIOD,
            "snapshot_id": meta_src.get("snapshot_id"),
            "notes": meta_src.get("notes"),
            "industry_total_label": INDUSTRY_TOTAL_CANONICAL,
        },
        "companies": sorted(makers),
        "flows": sorted(flows),
        "periods": periods,
        "ev_penetration": ev_penetration,
        "series": out_series,
    }


def _period_axis(months: list[date], period_type: str) -> list[dict]:
    seen: dict[str, date] = {}
    for d in months:
        key = _fq(d) if period_type == QUARTER else _fy(d)
        if key not in seen or d < seen[key]:
            seen[key] = d
    items = sorted(seen.items(), key=lambda kv: kv[1])
    if period_type == QUARTER:
        return [{"key": k, "label": quarter_label(k), "date": d.isoformat()} for k, d in items]
    return [{"key": k, "label": k, "date": d.isoformat()} for k, d in items]


def write_view(
    rows: Sequence[ContractRow], meta_src: dict, category: str = "2W", path: Path | None = None
) -> dict:
    view = build_view(rows, meta_src, category)
    path = path or view_path(category)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(view, separators=(",", ":")), encoding="utf-8")
    tmp.replace(path)
    return view


def write_manifest(views: list[dict], path: Path = MANIFEST_PATH) -> dict:
    """Manifest of available categories for the UI's category switch."""
    cats = [
        {
            "key": v["meta"]["category"],
            "label": v["meta"]["category_label"],
            "latest_period": v["meta"]["latest_period"],
            "coverage_start": v["meta"]["coverage_start"],
            "native_frequency": v["meta"]["native_frequency"],
            "has_ev": v["meta"]["has_ev"],
            "has_production": v["meta"]["has_production"],
            "source": v["meta"]["source"],
        }
        for v in views
    ]
    manifest = {"categories": cats}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest, separators=(",", ":")), encoding="utf-8")
    return manifest


def main() -> int:
    """Rebuild every category view present in data/normalized/ + the manifest."""
    from pipeline.store.normalized import NORMALIZED_DIR, load_normalized

    meta_src = {
        "generated_at": "2026-07-15T10:00:00+05:30",
        "source": "SIAM",
        "snapshot_id": None,
        "notes": None,
    }
    views = []
    for p in sorted(NORMALIZED_DIR.glob("*.json")):
        category = p.stem.upper()
        rows = load_normalized(category)
        if not rows:
            continue
        v = write_view(rows, meta_src, category)
        views.append(v)
        print(
            f"[build_view] {category}: {len(v['series'])} series, latest={v['meta']['latest_period']}"
        )
    if views:
        write_manifest(views)
        print(f"[build_view] manifest: {[v['meta']['category'] for v in views]}")
    return 0 if views else 1


if __name__ == "__main__":
    raise SystemExit(main())
