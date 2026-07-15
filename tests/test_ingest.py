"""Watched-folder ingest: adapter detection by sheet fingerprint (not filename)."""

from __future__ import annotations

from pathlib import Path

import pytest

from pipeline.adapters.excel_nested import NestedBlockAdapter
from pipeline.adapters.excel_spark import ExcelSparkAdapter
from pipeline.adapters.siam_monthly import SiamMonthlyAdapter
from pipeline.ingest import INGEST_TS, detect_adapters

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
    # 2W must come first (its EV subset must be built before dependents)
    assert [c for c, _a in adapters][0] == "2W"


@pytest.mark.skipif(not FILE2.exists(), reason="File 2 not present")
def test_detects_file2_as_siam_monthly() -> None:
    adapters = detect_adapters(FILE2, INGEST_TS)
    assert [c for c, _a in adapters] == ["2W"]
    assert isinstance(adapters[0][1], SiamMonthlyAdapter)
