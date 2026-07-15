"""The tidy 'normalized' store — the source of truth we append revisions to.

One JSON file per category under data/normalized/. Holds ALL rows (including superseded
ones) so the audit trail is complete; the live view is `current_rows()`.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from pathlib import Path

from pipeline.contract.models import ContractRow

NORMALIZED_DIR = Path("data/normalized")


def normalized_path(category: str, normalized_dir: Path = NORMALIZED_DIR) -> Path:
    return normalized_dir / f"{category.lower()}.json"


def load_normalized(category: str, normalized_dir: Path = NORMALIZED_DIR) -> list[ContractRow]:
    path = normalized_path(category, normalized_dir)
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    return [ContractRow.model_validate(r) for r in data["rows"]]


def save_normalized(
    category: str, rows: Sequence[ContractRow], normalized_dir: Path = NORMALIZED_DIR
) -> Path:
    normalized_dir.mkdir(parents=True, exist_ok=True)
    path = normalized_path(category, normalized_dir)
    payload = {
        "category": category,
        "row_count": len(rows),
        "rows": [r.model_dump(mode="json") for r in rows],
    }
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)  # atomic
    return path
