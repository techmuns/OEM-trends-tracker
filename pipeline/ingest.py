"""Watched-folder ingest — the automated pipeline entrypoint (monthly cron + dispatch).

Drop a source workbook in ``data/raw/incoming/`` and everything downstream runs unattended.
A single File-1 workbook carries several categories (2W, PV, …); each is a separate adapter
with its own store / snapshot / bundle / view. Every category runs independently:

    for each (category, adapter) in the file:
        parse -> apply revisions -> gates
          ├─ all pass -> snapshot -> normalized store -> per-category view (data/bundle/<cat>.json)
          └─ any fail -> quarantine the file -> keep the last good views LIVE -> non-zero exit

No human approval step; a bad file never poisons the store nor takes the dashboard down.
Idempotent: re-running the same file is a no-op. A manifest (categories.json) lists the
categories the UI can switch between.
"""

from __future__ import annotations

import json
import shutil
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import openpyxl

from pipeline.adapters.base import SourceAdapter
from pipeline.adapters.excel_nested import NestedBlockAdapter
from pipeline.adapters.excel_spark import ExcelSparkAdapter
from pipeline.adapters.siam_monthly import SiamMonthlyAdapter
from pipeline.build_bundle import build_bundle
from pipeline.build_view import BUNDLE_DIR, write_manifest, write_view
from pipeline.contract.constants import FILE1_LAST_PERIOD
from pipeline.store.normalized import load_normalized, save_normalized
from pipeline.store.revisions import apply_revisions, current_rows
from pipeline.store.snapshot import snapshot_id, write_snapshot
from pipeline.validate.gates import QUARANTINE_DIR, GateContext, quarantine_path, run_gates

SOURCE = "SIAM"
INCOMING_DIR = Path("data/raw/incoming")
PROCESSED_DIR = Path("data/raw/processed")
_IST = timezone(timedelta(hours=5, minutes=30))
INGEST_TS = datetime(2026, 7, 15, 10, 0, tzinfo=_IST)

FILE1_SHEET = "OEM - Summary - 2W, PV, 3W"
FILE2_SHEET = "Two Wheelers"


def detect_adapters(path: Path, ts: datetime) -> list[tuple[str, SourceAdapter]]:
    """Return the (category, adapter) pairs for a workbook — by sheet fingerprint."""
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        sheets = set(wb.sheetnames)
    finally:
        wb.close()
    if FILE1_SHEET in sheets:
        return [
            ("2W", ExcelSparkAdapter(path, ingest_date=ts)),
            ("PV", NestedBlockAdapter("PV", path, ingest_date=ts)),
            ("3W", NestedBlockAdapter("3W", path, ingest_date=ts)),
        ]
    if FILE2_SHEET in sheets and "Passenger Vehicle" in sheets:
        return [("2W", SiamMonthlyAdapter(path, ingest_date=ts))]
    return []


def _extras(adapter: SourceAdapter) -> dict:
    extras: dict = {}
    if isinstance(adapter, (ExcelSparkAdapter, NestedBlockAdapter)):
        extras["reconciliation"] = adapter.reconciliation
    if isinstance(adapter, SiamMonthlyAdapter):
        extras["seam_reference"] = adapter.seam_reference
    return extras


def _notes(category: str, live) -> str:
    latest = max(r.period_date for r in live).isoformat()
    if any("Monthly_SIAM" in r.source_file for r in live):
        return (
            f"Data through {latest}. Source: SIAM wholesale dispatches. File 1 (summary) "
            f"covers to {FILE1_LAST_PERIOD} with segment + EV detail; File 2 (monthly SIAM) "
            "extends maker-level totals past it. EV-vs-ICE and segments end "
            f"{FILE1_LAST_PERIOD}; maker values differ up to ~18% at the seam (File 1 not superseded)."
        )
    if category in ("PV", "3W"):
        label = "PV" if category == "PV" else "3W"
        return (
            f"Data through {latest}. Source: SIAM wholesale dispatches. EV is not derivable "
            f"for {label} — EV-only makers sit inline among ICE makers, so EV volume/share is "
            "not shown."
        )
    return f"Data through {latest}. Source: SIAM wholesale dispatches."


def process_category(category: str, adapter: SourceAdapter, ts: datetime) -> int:
    rows = adapter.parse(adapter.fetch("as_of"))
    adapter.validate(rows)
    previous = load_normalized(category)
    outcome = apply_revisions(previous, rows)
    store_rows = outcome.rows
    live = current_rows(store_rows)

    if previous and not outcome.added_keys and not outcome.revised_keys:
        print(f"[ingest] {category}: no change (idempotent).")
        return 0

    report = run_gates(GateContext(rows=live, previous_rows=previous, extras=_extras(adapter)))
    print(f"[ingest] {category}: {report.summary()}")
    for r in report.results:
        if r.status.value != "skip":
            print(f"      {r.name}: {r.status.value} — {r.message}")
    if not report.accepted:
        print(f"[ingest] {category}: FAILED — " + "; ".join(f"{f.name}: {f.message}" for f in report.failures), file=sys.stderr)
        return 1

    save_normalized(category, store_rows)
    write_snapshot(store_rows, ts, category=category)
    build_bundle(
        store_rows, generated_at=ts, source=SOURCE, category=category,
        snapshot_id=snapshot_id(ts), notes=_notes(category, live),
        bundle_path=BUNDLE_DIR / f"bundle-{category.lower()}.json",
    )
    write_view(
        store_rows,
        {"generated_at": ts.isoformat(), "source": SOURCE, "snapshot_id": snapshot_id(ts),
         "notes": _notes(category, live)},
        category,
    )
    print(f"[ingest] {category}: accepted. added={len(outcome.added_keys)} "
          f"revised={len(outcome.revised_keys)} latest={max(r.period_date for r in live)}")
    return 0


def process_file(path: Path, ts: datetime = INGEST_TS) -> int:
    adapters = detect_adapters(path, ts)
    if not adapters:
        _quarantine(path, "unrecognized workbook (no known category sheet)")
        return 1
    print(f"[ingest] {path.name}: categories {[c for c, _a in adapters]}")
    for category, adapter in adapters:
        if process_category(category, adapter, ts) != 0:
            _quarantine(path, f"{category} gates failed")
            return 1
    _rebuild_manifest()
    _archive(path)
    return 0


def _rebuild_manifest() -> None:
    # Views are data/bundle/<cat>.json. Skip the manifest and every canonical bundle
    # (legacy bundle.json + per-category bundle-<cat>.json) — those are not views.
    views = []
    for p in sorted(BUNDLE_DIR.glob("*.json")):
        if p.name == "categories.json" or p.name.startswith("bundle"):
            continue
        views.append(json.loads(p.read_text()))
    if views:
        write_manifest(views)


def _archive(path: Path) -> None:
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    dest = PROCESSED_DIR / path.name
    if path.resolve() != dest.resolve():
        shutil.move(str(path), str(dest))


def _quarantine(path: Path, reason: str) -> None:
    QUARANTINE_DIR.mkdir(parents=True, exist_ok=True)
    dest = quarantine_path(str(path))
    shutil.move(str(path), str(dest))
    print(f"[ingest] QUARANTINED {path.name} -> {dest}: {reason}", file=sys.stderr)
    print("[ingest] last good views left untouched.", file=sys.stderr)


def run_incoming(incoming_dir: Path = INCOMING_DIR, ts: datetime = INGEST_TS) -> int:
    files = sorted(p for p in incoming_dir.glob("*.xlsx") if p.is_file())
    if not files:
        print("[ingest] no files in incoming/ — nothing to do.")
        return 0
    worst = 0
    for path in files:
        worst = max(worst, process_file(path, ts))
    return worst


def main(argv: list[str] | None = None) -> int:
    return run_incoming()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
