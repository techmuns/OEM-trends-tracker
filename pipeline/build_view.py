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

VIEW_PATH = Path("data/bundle/2w.json")
MONTH, QUARTER, YEAR = "month", "quarter", "year"


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


def build_view(rows: Sequence[ContractRow], meta_src: dict) -> dict:
    current = [r for r in rows if not r.is_superseded and r.period_type.value == MONTH]
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
        for pt in (MONTH, QUARTER, YEAR):
            expected = 1 if pt == MONTH else (3 if pt == QUARTER else 12)
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
        for pt in (MONTH, QUARTER, YEAR):
            m: dict[str, float | None] = {}
            for key, dates in group_periods(ind_all, pt).items():
                a = sum(ind_all[d] for d in dates)
                e = matched_sum(ind_ev, dates)
                m[key] = (e / a) if (e is not None and a) else None
            ev_penetration[f][pt] = m

    # 6) period axes (labels, sorted)
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
        ],
        QUARTER: _period_axis(all_months, QUARTER),
        YEAR: _period_axis(all_months, YEAR),
    }

    latest = all_months[-1]
    ev_months = sorted({d for (c, f, p), m in mm.items() if p == "ev" for d in m})
    prod_months = sorted({d for (c, f, p), m in mm.items() if f == "production" for d in m})
    return {
        "meta": {
            "contract_version": CONTRACT_VERSION,
            "generated_at": meta_src["generated_at"],
            "category": "2W",
            "source": meta_src.get("source", "SIAM"),
            "source_universe_label": SOURCE_UNIVERSE_LABELS.get("SIAM", SIAM_UNIVERSE_LABEL),
            "share_caveat": SIAM_UNIVERSE_LABEL,
            "coverage_start": all_months[0].isoformat(),
            "latest_period": latest.isoformat(),
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


def write_view(rows: Sequence[ContractRow], meta_src: dict, path: Path = VIEW_PATH) -> dict:
    view = build_view(rows, meta_src)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(view, separators=(",", ":")), encoding="utf-8")
    tmp.replace(path)
    return view


def _default_meta_src() -> dict:
    from pipeline.store.normalized import normalized_path

    b = json.loads(Path("data/bundle/bundle.json").read_text())
    return {
        "generated_at": b["generated_at"],
        "source": b["meta"]["source"],
        "snapshot_id": b["meta"]["snapshot_id"],
        "notes": b["meta"]["notes"],
        "_normalized": str(normalized_path("2W")),
    }


def main() -> int:
    from pipeline.store.normalized import load_normalized

    rows = load_normalized("2W")
    if not rows:
        print("[build_view] no normalized store; run the ingest first.")
        return 1
    view = write_view(rows, _default_meta_src())
    print(
        f"[build_view] wrote {VIEW_PATH} — {len(view['series'])} series, "
        f"latest={view['meta']['latest_period']}, ev_latest={view['meta']['ev_latest_period']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
