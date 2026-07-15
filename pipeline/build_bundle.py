"""Tidy store -> UI bundle builder — SIGNATURE ONLY (implemented in Phase 1).

The bundle (data/bundle/bundle.json) is the single artifact the UI reads. It is a
schema-valid `Bundle`: contract_version, an injected generated_at, the source-universe
label, and the current (non-superseded) rows. Cloudflare Pages serves it; the UI binds to
the frozen contract, never to the pipeline internals.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime
from pathlib import Path

from pipeline.contract.models import Bundle, ContractRow

BUNDLE_PATH = Path("data/bundle/bundle.json")


def build_bundle(
    rows: Sequence[ContractRow],
    generated_at: datetime,
    source: str = "SIAM",
    bundle_path: Path = BUNDLE_PATH,
) -> Bundle:
    """Assemble the current store into a schema-valid Bundle and write it.

    Phase 1 will: take current (non-superseded) rows, attach the source-universe label
    from pipeline.contract.constants, validate the assembled Bundle against schema.json,
    and write it atomically so the last good bundle is never left half-written.
    """
    raise NotImplementedError("build_bundle is implemented in Phase 1.")
