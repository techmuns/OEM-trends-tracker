"""VAHAN adapter — STUB (Phase 2).

VAHAN reports registrations, a DIFFERENT measurement basis from SIAM dispatches. Rows
carry source='VAHAN'; the one-source-per-table rule keeps them from ever being mixed with
SIAM figures in a single table or share calculation.
"""

from __future__ import annotations

from pipeline.adapters.base import RawPayload, SourceAdapter, ValidationResult
from pipeline.contract.models import ContractRow

_PHASE = "Phase 2 (Live ingest)"


class VahanAdapter(SourceAdapter):
    source_id = "VAHAN"
    native_frequency = "month"

    def fetch(self, period: str) -> RawPayload:
        raise NotImplementedError(f"VahanAdapter.fetch is implemented in {_PHASE}.")

    def parse(self, raw: RawPayload) -> list[ContractRow]:
        raise NotImplementedError(f"VahanAdapter.parse is implemented in {_PHASE}.")

    def validate(self, rows: list[ContractRow]) -> ValidationResult:
        raise NotImplementedError(f"VahanAdapter.validate is implemented in {_PHASE}.")
