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
def schema() -> dict:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def bundle_dict() -> dict:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def bundle(bundle_dict: dict) -> Bundle:
    return Bundle.model_validate(bundle_dict)
