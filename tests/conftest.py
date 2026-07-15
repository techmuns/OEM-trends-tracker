"""Shared test fixtures."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from pipeline.contract.models import Bundle

REPO_ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = REPO_ROOT / "pipeline" / "contract" / "schema.json"
FIXTURE_PATH = REPO_ROOT / "fixtures" / "sample_bundle.json"


@pytest.fixture(scope="session")
def schema() -> dict:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def bundle_dict() -> dict:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def bundle(bundle_dict: dict) -> Bundle:
    return Bundle.model_validate(bundle_dict)
