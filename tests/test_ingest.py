"""Watched-folder ingest: adapter detection by sheet fingerprint (not filename)."""

from __future__ import annotations

from pathlib import Path

import pytest

import pipeline.ingest as ingest
from pipeline.adapters.excel_cv import CvQuarterlyAdapter
from pipeline.adapters.excel_nested import NestedBlockAdapter
from pipeline.adapters.excel_spark import ExcelSparkAdapter
from pipeline.adapters.siam_monthly import SiamMonthlyAdapter
from pipeline.ingest import INGEST_TS, detect_adapters, run_incoming
from pipeline.store.snapshot import snapshot_id

REPO = Path(__file__).resolve().parents[1]
FILE1 = REPO / "data" / "raw" / "Auto_Database__Summary__-_Spark.xlsx"
FILE2 = REPO / "data" / "raw" / "processed" / "Monthly_SIAM_Industry_Data_Jun26.xlsx"


@pytest.mark.skipif(not FILE1.exists(), reason="File 1 not present")
def test_detects_file1_as_multi_category() -> None:
    adapters = detect_adapters(FILE1, INGEST_TS)
    by_cat = dict(adapters)
    # File 1 carries several categories, each a distinct adapter
    assert isinstance(by_cat["2W"], ExcelSparkAdapter)
    assert isinstance(by_cat["PV"], NestedBlockAdapter)
    assert isinstance(by_cat["3W"], NestedBlockAdapter)
    assert isinstance(by_cat["CV"], CvQuarterlyAdapter)
    # 2W must come first (its EV subset must be built before dependents)
    assert [c for c, _a in adapters][0] == "2W"


@pytest.mark.skipif(not FILE2.exists(), reason="File 2 not present")
def test_detects_file2_as_siam_monthly() -> None:
    adapters = detect_adapters(FILE2, INGEST_TS)
    assert [c for c, _a in adapters] == ["2W"]
    assert isinstance(adapters[0][1], SiamMonthlyAdapter)


def test_each_ingest_unit_gets_a_distinct_snapshot_timestamp(tmp_path, monkeypatch) -> None:
    """Regression: File 1 (the 2W baseline) and File 2 (the 2W monthly extension) both carry a
    2W category. When run_incoming reused ONE injected timestamp for every file, File 2's 2W
    ingest wrote the same immutable snapshot id as File 1's and collided (FileExistsError) —
    quarantining a perfectly good file AND leaving the normalized store half-updated. Each
    processing unit (file or VAHAN batch) must get its own snapshot timestamp."""
    for name in (
        "Auto_Database__Summary__-_Spark.xlsx",  # File 1 -> 2W/PV/3W/CV
        "Monthly_SIAM_Industry_Data_Jun26.xlsx",  # File 2 -> 2W  (shares 2W with File 1)
        "VAHAN-2W-2026-Maker.xlsx",  # VAHAN 2W batch (maker + fuel = one unit)
        "VAHAN-2W-2026-Fuel.xlsx",
    ):
        (tmp_path / name).write_bytes(b"stub")

    seen: list = []
    monkeypatch.setattr(ingest, "_is_vahan", lambda p: "VAHAN" in p.name)
    monkeypatch.setattr(ingest, "process_file", lambda path, ts: seen.append(ts) or 0)
    monkeypatch.setattr(
        ingest, "_process_vahan_batch", lambda paths, category, ts: seen.append(ts) or 0
    )

    rc = run_incoming(incoming_dir=tmp_path, ts=INGEST_TS)

    assert rc == 0
    # 2 non-VAHAN files + 1 VAHAN(2W) batch = 3 units
    assert len(seen) == 3
    ids = [snapshot_id(t) for t in seen]
    assert len(set(ids)) == 3, f"snapshot ids collided across ingest units: {ids}"


def test_run_incoming_defaults_to_wall_clock_when_no_timestamp(tmp_path) -> None:
    """Production (cron/upload) injects no timestamp: run_incoming must fall back to the real
    clock so a recurring monthly file never reuses last run's frozen snapshot id. An empty
    incoming dir exercises that default path without touching the store."""
    assert run_incoming(incoming_dir=tmp_path) == 0
