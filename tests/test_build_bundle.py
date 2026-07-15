"""build_bundle: schema-valid Bundle with correct meta, atomic write, no empty bundle."""

from __future__ import annotations

import json
from pathlib import Path

import jsonschema
import pytest

from pipeline.build_bundle import build_bundle
from pipeline.contract.models import Bundle

SCHEMA = json.loads(
    (Path(__file__).resolve().parents[1] / "pipeline" / "contract" / "schema.json").read_text()
)


def test_build_bundle_writes_valid_meta(bundle: Bundle, tmp_path: Path) -> None:
    live = [r for r in bundle.rows if not r.is_superseded]
    out = tmp_path / "bundle.json"
    built = build_bundle(
        bundle.rows,
        generated_at=bundle.generated_at,
        source="SIAM",
        category="2W",
        snapshot_id="20260715T090000Z",
        notes="test",
        bundle_path=out,
    )
    assert out.exists()
    payload = json.loads(out.read_text())
    jsonschema.validate(payload, SCHEMA)
    assert payload["meta"]["latest_period"] == max(r.period_date for r in live).isoformat()
    assert payload["meta"]["snapshot_id"] == "20260715T090000Z"
    assert payload["meta"]["row_count"] == len(live)
    assert built.rows and all(not r.is_superseded for r in built.rows)


def test_build_bundle_refuses_empty(bundle: Bundle, tmp_path: Path) -> None:
    with pytest.raises(ValueError):
        build_bundle([], generated_at=bundle.generated_at, bundle_path=tmp_path / "b.json")
