"""Phase 1 backfill orchestrator: File 1 -> tidy store -> snapshot -> 2W bundle.

Fully automated, zero human approval:
  parse -> apply revisions -> run gates
    all gates pass  -> accept: save normalized store, write immutable snapshot, build bundle
    any gate fails  -> quarantine the source file, keep the last good bundle, exit non-zero

Run: `uv run python -m pipeline.backfill [path-to-xlsx]`
"""

from __future__ import annotations

import shutil
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

from pipeline.adapters.excel_spark import ExcelSparkAdapter
from pipeline.build_bundle import build_bundle
from pipeline.build_view import BUNDLE_DIR, write_view
from pipeline.store.normalized import load_normalized, save_normalized
from pipeline.store.revisions import apply_revisions, current_rows
from pipeline.store.snapshot import snapshot_id, write_snapshot
from pipeline.validate.gates import QUARANTINE_DIR, GateContext, quarantine_path, run_gates

CATEGORY = "2W"
SOURCE = "SIAM"
DEFAULT_FILE = Path("data/raw/Auto_Database__Summary__-_Spark.xlsx")
_IST = timezone(timedelta(hours=5, minutes=30))
# Injected ingest timestamp: fixed so a re-run of the same file produces identical output.
INGEST_TS = datetime(2026, 7, 15, 9, 0, tzinfo=_IST)
SOURCE_PERIOD = "2025-12"


def run_backfill(source_file: Path = DEFAULT_FILE, ts: datetime = INGEST_TS) -> int:
    adapter = ExcelSparkAdapter(source_file, ingest_date=ts, source_period=SOURCE_PERIOD)
    rows = adapter.parse(adapter.fetch(SOURCE_PERIOD))
    self_check = adapter.validate(rows)
    print(f"[backfill] parsed {len(rows)} rows; adapter self-check ok={self_check.ok}")

    previous = load_normalized(CATEGORY)
    outcome = apply_revisions(previous, rows)
    store_rows = outcome.rows
    live = current_rows(store_rows)

    if previous and not outcome.added_keys and not outcome.revised_keys:
        # idempotent re-run: the store already reflects this file. Do not write a new
        # (immutable) snapshot for an unchanged store.
        print("[backfill] no changes vs current store; nothing to write.")
        return 0

    ctx = GateContext(
        rows=live,
        previous_rows=previous,
        extras={"reconciliation": adapter.reconciliation},
    )
    report = run_gates(ctx)
    print(f"[backfill] {report.summary()}")
    for r in report.results:
        print(f"    - {r.name}: {r.status.value} — {r.message}")

    if not report.accepted:
        QUARANTINE_DIR.mkdir(parents=True, exist_ok=True)
        dest = quarantine_path(str(source_file))
        shutil.copy2(source_file, dest)
        print(f"[backfill] QUARANTINED -> {dest}. Last good bundle preserved.", file=sys.stderr)
        for f in report.failures:
            print(f"    FAIL {f.name}: {f.message} {f.details}", file=sys.stderr)
        return 1

    # accept
    save_normalized(CATEGORY, store_rows)
    snap = write_snapshot(store_rows, ts)
    sid = snapshot_id(ts)
    latest = max(r.period_date for r in live)
    build_bundle(
        store_rows,
        generated_at=ts,
        source=SOURCE,
        category=CATEGORY,
        snapshot_id=sid,
        notes=(
            f"Data ends {latest.isoformat()}; no live feed until Phase 2. "
            "Source: SIAM wholesale dispatches (manually maintained summary workbook)."
        ),
        bundle_path=BUNDLE_DIR / f"bundle-{CATEGORY.lower()}.json",
    )
    write_view(
        store_rows,
        {
            "generated_at": ts.isoformat(),
            "source": SOURCE,
            "snapshot_id": sid,
            "notes": f"Data ends {latest.isoformat()}. Source: SIAM wholesale dispatches.",
        },
    )
    _print_stats(live, outcome, report, adapter)
    print(f"[backfill] accepted. snapshot={snap.name} latest_period={latest}")
    return 0


def _print_stats(live, outcome, report, adapter) -> None:
    by = Counter((r.flow.value, r.powertrain.value) for r in live if r.period_type.value == "month")
    print("[backfill] monthly rows by flow/powertrain:")
    for k, v in sorted(by.items()):
        print(f"    {k}: {v}")
    tr = next((r for r in report.results if r.name == "totals_reconciliation"), None)
    if tr:
        d = tr.details
        print(
            f"[backfill] quarter reconciliation: {d.get('quarter_match')}/{d.get('quarter_compared')} "
            f"match; pre-FY15 exceptions={d.get('pre_fy15_exceptions')}"
        )
    print(
        f"[backfill] added={len(outcome.added_keys)} revised={len(outcome.revised_keys)} unchanged={outcome.unchanged}"
    )


def main(argv: list[str] | None = None) -> int:
    argv = argv if argv is not None else sys.argv[1:]
    source = Path(argv[0]) if argv else DEFAULT_FILE
    if not source.exists():
        print(f"[backfill] source file not found: {source}", file=sys.stderr)
        return 2
    return run_backfill(source)


if __name__ == "__main__":
    sys.exit(main())
