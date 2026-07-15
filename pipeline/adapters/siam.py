"""SIAM adapter — STUB (Phase 2).

SIAM publishes wholesale dispatches (not registrations). native_frequency is monthly for
2W/PV/3W/Tractor and quarterly for CV — the CV path must emit calc_status='reported' at
quarter grain, never a synthesised monthly figure.
"""

from __future__ import annotations

from pipeline.adapters.base import RawPayload, SourceAdapter, ValidationResult
from pipeline.contract.models import ContractRow

_PHASE = "Phase 2 (Live ingest)"


class SiamAdapter(SourceAdapter):
    source_id = "SIAM"
    native_frequency = "month"  # CV overrides to 'quarter' per-payload in Phase 2

    def fetch(self, period: str) -> RawPayload:
        raise NotImplementedError(f"SiamAdapter.fetch is implemented in {_PHASE}.")

    def parse(self, raw: RawPayload) -> list[ContractRow]:
        raise NotImplementedError(f"SiamAdapter.parse is implemented in {_PHASE}.")

    def validate(self, rows: list[ContractRow]) -> ValidationResult:
        raise NotImplementedError(f"SiamAdapter.validate is implemented in {_PHASE}.")
