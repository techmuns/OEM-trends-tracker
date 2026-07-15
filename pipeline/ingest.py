"""Watched-folder ingest — the automated pipeline entrypoint (monthly cron + dispatch).

Drop a source workbook in ``data/raw/incoming/`` and everything downstream runs unattended:

    detect adapter -> parse -> apply revisions -> gates
      ├─ all pass -> snapshot -> normalized store -> bundle -> archive to processed/  (exit 0)
      └─ any fail -> quarantine the file -> keep the last good bundle LIVE -> exit non-zero

No human approval step. A bad file may never poison the store nor take the dashboard down:
on failure nothing downstream is rewritten, so the last committed bundle stays published,
and the non-zero exit is the alert (a GitHub Actions failure). Idempotent: re-running the
same file is a no-op (already archived, or no store change -> no new snapshot).
"""

from __future__ import annotations

import shutil
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import openpyxl

from pipeline.adapters.base import SourceAdapter
from pipeline.adapters.excel_spark import ExcelSparkAdapter
from pipeline.adapters.siam_monthly import SiamMonthlyAdapter
from pipeline.build_bundle import build_bundle
from pipeline.contract.constants import FILE1_LAST_PERIOD
from pipeline.store.normalized import load_normalized, save_normalized
from pipeline.store.revisions import apply_revisions, current_rows
from pipeline.store.snapshot import snapshot_id, write_snapshot
from pipeline.validate.gates import QUARANTINE_DIR, GateContext, quarantine_path, run_gates

CATEGORY = "2W"
SOURCE = "SIAM"
INCOMING_DIR = Path("data/raw/incoming")
PROCESSED_DIR = Path("data/raw/processed")
_IST = timezone(timedelta(hours=5, minutes=30))
INGEST_TS = datetime(2026, 7, 15, 10, 0, tzinfo=_IST)

# adapter selection by sheet fingerprint (never by filename)
FILE1_SHEET = "OEM - Summary - 2W, PV, 3W"
FILE2_SHEET = "Two Wheelers"


def detect_adapter(path: Path, ts: datetime) -> SourceAdapter | None:
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        sheets = set(wb.sheetnames)
    finally:
        wb.close()
    if FILE1_SHEET in sheets:
        return ExcelSparkAdapter(path, ingest_date=ts)
    if FILE2_SHEET in sheets and "Passenger Vehicle" in sheets:
        return SiamMonthlyAdapter(path, ingest_date=ts)
    return None


def _extras(adapter: SourceAdapter) -> dict:
    extras: dict = {}
    if isinstance(adapter, ExcelSparkAdapter):
        extras["reconciliation"] = adapter.reconciliation
    if isinstance(adapter, SiamMonthlyAdapter):
        extras["seam_reference"] = adapter.seam_reference
    return extras


def _bundle_notes(live) -> str:
    latest = max(r.period_date for r in live).isoformat()
    sources = {r.source_file for r in live}
    has_f2 = any("Monthly_SIAM" in s for s in sources)
    note = f"Data through {latest}. Source: SIAM wholesale dispatches."
    if has_f2:
        note += (
            f" File 1 (summary) covers 2012–{FILE1_LAST_PERIOD} with segment + EV detail; "
            "File 2 (monthly SIAM) extends maker-level totals past that date. "
            "EV-vs-ICE and segment breakdowns are not available after "
            f"{FILE1_LAST_PERIOD}; maker values differ up to ~18% between the two sources "
            "at the seam (reported, File 1 not superseded)."
        )
    return note


def process_file(path: Path, ts: datetime = INGEST_TS) -> int:
    adapter = detect_adapter(path, ts)
    if adapter is None:
        _quarantine(path, "unrecognized workbook (no known category sheet)")
        return 1

    rows = adapter.parse(adapter.fetch(str(path.stem)))
    self_check = adapter.validate(rows)
    print(
        f"[ingest] {path.name}: {adapter.__class__.__name__} parsed {len(rows)} rows "
        f"(self-check ok={self_check.ok})"
    )

    previous = load_normalized(CATEGORY)
    outcome = apply_revisions(previous, rows)
    store_rows = outcome.rows
    live = current_rows(store_rows)

    if previous and not outcome.added_keys and not outcome.revised_keys:
        _archive(path)
        print(f"[ingest] {path.name}: no store change (idempotent no-op). Archived.")
        return 0

    report = run_gates(GateContext(rows=live, previous_rows=previous, extras=_extras(adapter)))
    print(f"[ingest] {report.summary()}")
    for r in report.results:
        print(f"    - {r.name}: {r.status.value} — {r.message}")

    if not report.accepted:
        _quarantine(path, "; ".join(f"{f.name}: {f.message}" for f in report.failures))
        return 1

    # accept
    save_normalized(CATEGORY, store_rows)
    write_snapshot(store_rows, ts)
    build_bundle(
        store_rows,
        generated_at=ts,
        source=SOURCE,
        category=CATEGORY,
        snapshot_id=snapshot_id(ts),
        notes=_bundle_notes(live),
    )
    if outcome.revised_keys:
        print(f"[ingest] {len(outcome.revised_keys)} revisions applied (superseded, not deleted).")
    _archive(path)
    print(
        f"[ingest] {path.name}: accepted. added={len(outcome.added_keys)} "
        f"revised={len(outcome.revised_keys)} latest={max(r.period_date for r in live)}"
    )
    return 0


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
    print("[ingest] last good bundle left untouched.", file=sys.stderr)


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
