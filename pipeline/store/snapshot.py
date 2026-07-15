"""Immutable snapshot writer.

Every accepted ingest writes one immutable, timestamped snapshot of the tidy store under
data/snapshots/. Snapshots are never mutated or deleted — they are the audit trail. The
timestamp is INJECTED by the caller, never read from the wall clock inside this module, so
the writer is deterministic and testable.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from datetime import datetime
from pathlib import Path

from pipeline.contract.constants import CONTRACT_VERSION
from pipeline.contract.models import ContractRow

SNAPSHOTS_DIR = Path("data/snapshots")


def snapshot_id(ts: datetime) -> str:
    """Deterministic snapshot id from an injected timestamp, e.g. '20260701T000000Z'."""
    return ts.strftime("%Y%m%dT%H%M%S") + ("Z" if ts.utcoffset() is not None else "")


def write_snapshot(
    rows: Sequence[ContractRow],
    ts: datetime,
    snapshots_dir: Path = SNAPSHOTS_DIR,
    category: str | None = None,
) -> Path:
    """Write an immutable snapshot and return its path.

    Refuses to overwrite an existing snapshot id — snapshots are immutable by contract.
    A category (2W/PV/…) is included in the filename so multiple categories can snapshot at
    the same timestamp without colliding.
    """
    snapshots_dir.mkdir(parents=True, exist_ok=True)
    tag = f"{category.lower()}-" if category else ""
    path = snapshots_dir / f"snapshot-{tag}{snapshot_id(ts)}.json"
    if path.exists():
        raise FileExistsError(
            f"snapshot {path} already exists; snapshots are immutable and never overwritten."
        )
    payload = {
        "contract_version": CONTRACT_VERSION,
        "snapshot_id": snapshot_id(ts),
        "generated_at": ts.isoformat(),
        "row_count": len(rows),
        "rows": [r.model_dump(mode="json") for r in rows],
    }
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    return path
