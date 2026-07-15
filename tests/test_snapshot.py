"""Snapshot writer: immutable, timestamped, deterministic (injected timestamp)."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from pipeline.store.snapshot import snapshot_id, write_snapshot

IST = timezone(timedelta(hours=5, minutes=30))
TS = datetime(2026, 7, 1, 0, 0, 0, tzinfo=IST)


def test_snapshot_id_is_deterministic() -> None:
    assert snapshot_id(TS) == "20260701T000000Z"
    assert snapshot_id(TS) == snapshot_id(TS)


def test_write_snapshot_creates_immutable_file(bundle, tmp_path: Path) -> None:
    live = [r for r in bundle.rows if not r.is_superseded]
    path = write_snapshot(live, TS, snapshots_dir=tmp_path)
    assert path.exists()
    data = json.loads(path.read_text())
    assert data["row_count"] == len(live)
    assert data["contract_version"] == "1.0.0"
    assert data["snapshot_id"] == "20260701T000000Z"


def test_snapshot_refuses_overwrite(bundle, tmp_path: Path) -> None:
    write_snapshot(bundle.rows, TS, snapshots_dir=tmp_path)
    with pytest.raises(FileExistsError):
        write_snapshot(bundle.rows, TS, snapshots_dir=tmp_path)
