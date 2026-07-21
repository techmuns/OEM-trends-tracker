"""Build a SELF-CONTAINED VAHAN registrations artifact — fully isolated from SIAM.

Writes data/vahan/registrations.json. It deliberately does NOT touch data/bundle/*.json
(the SIAM views) or dist/: VAHAN is a separate source (registrations, not dispatches) and
must never overwrite or mix with SIAM. The one-source-per-table rule is honoured by keeping
the two in entirely separate files.

Inputs are the manually-downloaded VAHAN dashboard exports (see pipeline/adapters/vahan_file):
  * Vehicle Class exports (per category) -> monthly registration totals for 2W/PV/3W/CV.
  * Fuel export (all vehicles)            -> an all-India EV-vs-ICE summary (informational;
                                             not per-category — VAHAN doesn't cross the two).
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from pipeline.adapters.vahan_file import VahanFileAdapter, parse_report

OUT_DIR = Path("data/vahan")
OUT_PATH = OUT_DIR / "registrations.json"

# Battery-electric fuels in a VAHAN "Fuel" export. Strong/plug-in hybrids are deliberately
# excluded from the strict EV count (they still burn fuel); they are reported separately.
EV_FUELS = {"PURE EV", "ELECTRIC(BOV)"}
HYBRID_FUELS = {"PLUG-IN HYBRID EV", "STRONG HYBRID EV", "FUEL CELL HYDROGEN"}


def _month_key(year: int, month: int) -> str:
    return f"{year}-{month:02d}"


def build_categories(class_files: dict[str, Path], ingest_date: datetime) -> dict:
    """Vehicle Class exports -> {category: {monthly: {YYYY-MM: n}, ytd: N}}."""
    out: dict[str, dict] = {}
    for path in class_files.values():
        adapter = VahanFileAdapter(path, ingest_date=ingest_date)
        rows = adapter.parse(adapter.fetch("as_of"))
        for r in rows:
            cat = out.setdefault(r.category.value, {"monthly": {}, "ytd": 0})
            cat["monthly"][_month_key(r.period_date.year, r.period_date.month)] = int(r.value)
            cat["ytd"] += int(r.value)
    return dict(sorted(out.items()))


def build_ev_summary(fuel_file: Path) -> dict:
    """Fuel export -> all-India EV / hybrid / total monthly + YTD share (all vehicle types)."""
    rep = parse_report(fuel_file)
    ev: dict[str, int] = {}
    hybrid: dict[str, int] = {}
    total: dict[str, int] = {}
    for label, series in rep.rows.items():
        up = label.upper()
        for month, value in series.items():
            if value is None:
                continue
            key = _month_key(rep.year, month)
            total[key] = total.get(key, 0) + int(value)
            if up in EV_FUELS:
                ev[key] = ev.get(key, 0) + int(value)
            elif up in HYBRID_FUELS:
                hybrid[key] = hybrid.get(key, 0) + int(value)
    ytd_ev, ytd_total = sum(ev.values()), sum(total.values())
    return {
        "scope": "all vehicle types combined (VAHAN does not cross fuel x category)",
        "ev_fuels": sorted(EV_FUELS),
        "monthly_ev": dict(sorted(ev.items())),
        "monthly_hybrid": dict(sorted(hybrid.items())),
        "monthly_total": dict(sorted(total.items())),
        "ytd_ev": ytd_ev,
        "ytd_total": ytd_total,
        "ev_share_ytd": round(ytd_ev / ytd_total, 4) if ytd_total else None,
    }


def build(class_files: dict[str, Path], fuel_file: Path | None, ingest_date: datetime) -> dict:
    categories = build_categories(class_files, ingest_date)
    artifact = {
        "source": "VAHAN",
        "basis": "registrations",
        "universe_label": "Share within reported VAHAN (registrations) universe",
        "geography": "IN",
        "generated_at": ingest_date.isoformat(),
        "note": (
            "VAHAN registrations (retail, at the RTO) — a DIFFERENT basis from SIAM wholesale "
            "dispatches. Separate series; never mixed with SIAM. No exports/production in VAHAN."
        ),
        "categories": categories,
    }
    if fuel_file is not None and fuel_file.exists():
        artifact["ev_all_vehicles"] = build_ev_summary(fuel_file)
    return artifact


def write(artifact: dict, out_path: Path = OUT_PATH) -> Path:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(artifact, indent=2), encoding="utf-8")
    return out_path


def main() -> int:
    fix = Path("fixtures/vahan")
    class_files = {
        "2W": fix / "vahan_class_2w_2026.xlsx",
        "PV": fix / "vahan_class_pv_2026.xlsx",
        "3W": fix / "vahan_class_3w_2026.xlsx",
        "CV": fix / "vahan_class_cv_2026.xlsx",
    }
    fuel_file = fix / "vahan_fuel_2026.xlsx"
    from datetime import timezone

    ist = timezone(__import__("datetime").timedelta(hours=5, minutes=30))
    artifact = build(class_files, fuel_file, datetime(2026, 7, 21, tzinfo=ist))
    path = write(artifact)
    print(f"[build_vahan] wrote {path}")
    for cat, d in artifact["categories"].items():
        print(f"  {cat}: YTD registrations = {d['ytd']:,}")
    if "ev_all_vehicles" in artifact:
        ev = artifact["ev_all_vehicles"]
        print(
            f"  EV (all vehicles): {ev['ytd_ev']:,} / {ev['ytd_total']:,} = {ev['ev_share_ytd']:.1%} YTD"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
