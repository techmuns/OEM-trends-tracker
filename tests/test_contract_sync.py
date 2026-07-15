"""The frozen contract must stay in sync across schema.json, models.py, and types.ts.

Two guarantees:
  1. Structural parity (always runs, no external tools): the same field set and the same
     enums appear in all three artifacts.
  2. Regeneration is clean (runs when uv+pnpm are present, e.g. CI): running
     scripts/gen-contract.sh leaves models.py and types.ts byte-identical.
"""

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

import pytest

from pipeline.contract.models import ContractRow

REPO_ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = REPO_ROOT / "pipeline" / "contract" / "schema.json"
TYPES_PATH = REPO_ROOT / "pipeline" / "contract" / "types.ts"


def _schema_row_fields(schema: dict) -> set[str]:
    return set(schema["$defs"]["ContractRow"]["properties"].keys())


def _ts_interface_fields(source: str, interface: str) -> set[str]:
    m = re.search(rf"export interface {interface} \{{(.*?)\n\}}", source, re.DOTALL)
    assert m, f"interface {interface} not found in types.ts"
    body = m.group(1)
    fields: set[str] = set()
    for line in body.splitlines():
        line = line.strip()
        if not line or line.startswith(("*", "/*", "//")):
            continue
        fm = re.match(r"([A-Za-z_][A-Za-z0-9_]*)\??\s*:", line)
        if fm:
            fields.add(fm.group(1))
    return fields


def test_row_fields_match_across_schema_pydantic_ts(schema: dict) -> None:
    schema_fields = _schema_row_fields(schema)
    pydantic_fields = set(ContractRow.model_fields.keys())
    ts_fields = _ts_interface_fields(TYPES_PATH.read_text(encoding="utf-8"), "ContractRow")

    assert schema_fields == pydantic_fields, (
        f"schema vs pydantic differ: {schema_fields ^ pydantic_fields}"
    )
    assert schema_fields == ts_fields, f"schema vs TS differ: {schema_fields ^ ts_fields}"


def test_enums_match_schema(schema: dict) -> None:
    props = schema["$defs"]["ContractRow"]["properties"]
    # every schema enum equals the corresponding pydantic enum's members
    for field_name, spec in props.items():
        if "enum" not in spec:
            continue
        model_field = ContractRow.model_fields[field_name]
        annotation = model_field.annotation
        members = getattr(annotation, "__members__", None)
        assert members is not None, f"{field_name} should map to an Enum in pydantic"
        assert set(spec["enum"]) == {e.value for e in members.values()}, (
            f"enum mismatch for {field_name}"
        )


def test_contract_version_const(schema: dict) -> None:
    assert schema["properties"]["contract_version"]["const"] == "1.1.0"


@pytest.mark.skipif(
    shutil.which("uv") is None or shutil.which("pnpm") is None,
    reason="codegen tools (uv/pnpm) not on PATH",
)
def test_regeneration_is_byte_stable() -> None:
    """Regenerate the bindings and assert the committed files did not change."""
    before_models = (REPO_ROOT / "pipeline" / "contract" / "models.py").read_bytes()
    before_types = TYPES_PATH.read_bytes()
    try:
        subprocess.run(
            ["bash", "scripts/gen-contract.sh"],
            cwd=REPO_ROOT,
            check=True,
            capture_output=True,
        )
    except subprocess.CalledProcessError as e:  # pragma: no cover - CI diagnostic
        pytest.fail(f"gen-contract.sh failed: {e.stderr.decode()[-2000:]}")
    after_models = (REPO_ROOT / "pipeline" / "contract" / "models.py").read_bytes()
    after_types = TYPES_PATH.read_bytes()
    assert before_models == after_models, "models.py drifted from schema.json — regenerate"
    assert before_types == after_types, "types.ts drifted from schema.json — regenerate"
