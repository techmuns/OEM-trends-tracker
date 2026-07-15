"""Tidy store -> UI bundle builder (Phase 1 implementation).

The bundle (data/bundle/bundle.json) is the single artifact the UI reads. It is a
schema-valid `Bundle`: contract_version, an injected generated_at, the source-universe
label, `meta` (freshness/coverage), and the current (non-superseded) rows. Written
atomically so the last good bundle is never left half-written; Cloudflare Pages serves it.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from datetime import datetime
from pathlib import Path

from jsonschema import Draft202012Validator

from pipeline.contract.constants import CONTRACT_VERSION, SOURCE_UNIVERSE_LABELS
from pipeline.contract.models import Bundle, BundleMeta, ContractRow
from pipeline.store.revisions import current_rows

BUNDLE_PATH = Path("data/bundle/bundle.json")
SCHEMA_PATH = Path(__file__).resolve().parent / "contract" / "schema.json"


def build_bundle(
    rows: Sequence[ContractRow],
    generated_at: datetime,
    source: str = "SIAM",
    category: str | None = "2W",
    snapshot_id: str | None = None,
    notes: str | None = None,
    bundle_path: Path = BUNDLE_PATH,
) -> Bundle:
    """Assemble the current store into a schema-valid Bundle and write it atomically."""
    live = current_rows(rows)
    if not live:
        raise ValueError("refusing to build an empty bundle")
    period_dates = [r.period_date for r in live]
    bundle = Bundle(
        contract_version=CONTRACT_VERSION,
        generated_at=generated_at,
        source_universe_label=SOURCE_UNIVERSE_LABELS[source],
        meta=BundleMeta(
            category=category,
            source=source,
            coverage_start=min(period_dates),
            latest_period=max(period_dates),
            snapshot_id=snapshot_id,
            row_count=len(live),
            notes=notes,
        ),
        rows=list(live),
    )

    # validate the assembled bundle against the schema before publishing
    payload = bundle.model_dump(mode="json")
    Draft202012Validator(json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))).validate(payload)

    bundle_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = bundle_path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    tmp.replace(bundle_path)  # atomic: last good bundle never half-written
    return bundle
