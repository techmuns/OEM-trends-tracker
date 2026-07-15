"""Watched-folder ingest: adapter detection by sheet fingerprint (not filename)."""

from __future__ import annotations

from pathlib import Path

import pytest

from pipeline.adapters.excel_spark import ExcelSparkAdapter
from pipeline.adapters.siam_monthly import SiamMonthlyAdapter
from pipeline.ingest import INGEST_TS, detect_adapter

REPO = Path(__file__).resolve().parents[1]
FILE1 = REPO / "data" / "raw" / "Auto_Database__Summary__-_Spark.xlsx"
FILE2 = REPO / "data" / "raw" / "processed" / "Monthly_SIAM_Industry_Data_Jun26.xlsx"


@pytest.mark.skipif(not FILE1.exists(), reason="File 1 not present")
def test_detects_file1_as_excel_spark() -> None:
    assert isinstance(detect_adapter(FILE1, INGEST_TS), ExcelSparkAdapter)


@pytest.mark.skipif(not FILE2.exists(), reason="File 2 not present")
def test_detects_file2_as_siam_monthly() -> None:
    assert isinstance(detect_adapter(FILE2, INGEST_TS), SiamMonthlyAdapter)
