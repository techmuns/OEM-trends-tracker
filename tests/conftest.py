"""Shared test fixtures."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from pipeline.contract.models import Bundle

REPO_ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = REPO_ROOT / "pipeline" / "contract" / "schema.json"
FIXTURE_PATH = REPO_ROOT / "fixtures" / "sample_bundle.json"
REAL_WORKBOOK = REPO_ROOT / "data" / "raw" / "Auto_Database__Summary__-_Spark.xlsx"
REAL_WORKBOOK_F2 = (
    REPO_ROOT / "data" / "raw" / "processed" / "Monthly_SIAM_Industry_Data_Jun26.xlsx"
)
_IST = timezone(timedelta(hours=5, minutes=30))


@pytest.fixture(scope="session")
def real_parse():
    """Parse the committed File 1 once. Skips if the workbook is not present in the repo."""
    if not REAL_WORKBOOK.exists():
        pytest.skip("real workbook data/raw/Auto_Database__Summary__-_Spark.xlsx not present")
    from pipeline.adapters.excel_spark import ExcelSparkAdapter

    adapter = ExcelSparkAdapter(REAL_WORKBOOK, ingest_date=datetime(2026, 7, 15, 9, 0, tzinfo=_IST))
    rows = adapter.parse(adapter.fetch("2025-12"))
    return adapter, rows


@pytest.fixture(scope="session")
def real_parse_f2():
    """Parse the committed File 2 (monthly SIAM) once. Skips if not present."""
    if not REAL_WORKBOOK_F2.exists():
        pytest.skip("File 2 workbook not present in data/raw/processed/")
    from pipeline.adapters.siam_monthly import SiamMonthlyAdapter

    adapter = SiamMonthlyAdapter(
        REAL_WORKBOOK_F2, ingest_date=datetime(2026, 7, 15, 10, 0, tzinfo=_IST)
    )
    rows = adapter.parse(adapter.fetch("2026-05"))
    return adapter, rows


@pytest.fixture(scope="session")
def real_parse_pv():
    """Parse the PV blocks of the committed File 1 once. Skips if not present."""
    if not REAL_WORKBOOK.exists():
        pytest.skip("real workbook data/raw/Auto_Database__Summary__-_Spark.xlsx not present")
    from pipeline.adapters.excel_nested import NestedBlockAdapter

    adapter = NestedBlockAdapter(
        "PV", REAL_WORKBOOK, ingest_date=datetime(2026, 7, 15, 9, 0, tzinfo=_IST)
    )
    rows = adapter.parse(adapter.fetch("2025-12"))
    return adapter, rows


@pytest.fixture(scope="session")
def real_parse_3w():
    """Parse the 3W blocks of the committed File 1 once. Skips if not present."""
    if not REAL_WORKBOOK.exists():
        pytest.skip("real workbook data/raw/Auto_Database__Summary__-_Spark.xlsx not present")
    from pipeline.adapters.excel_nested import NestedBlockAdapter

    adapter = NestedBlockAdapter(
        "3W", REAL_WORKBOOK, ingest_date=datetime(2026, 7, 15, 9, 0, tzinfo=_IST)
    )
    rows = adapter.parse(adapter.fetch("2025-12"))
    return adapter, rows


@pytest.fixture(scope="session")
def schema() -> dict:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def bundle_dict() -> dict:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def bundle(bundle_dict: dict) -> Bundle:
    return Bundle.model_validate(bundle_dict)
