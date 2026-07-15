"""Source-adapter interface.

Every source — the Excel drop, SIAM, VAHAN, a future paid API — implements this one
interface. It is what makes the feed pluggable: the pipeline and UI never change when a
source changes. Phase 0 defines the ABC and the shared result types ONLY; concrete
adapters are stubs that raise NotImplementedError. The point is to prove the single
interface holds for all three source shapes (file drop, scraper, API) before any is built.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field

from pipeline.contract.models import ContractRow


@dataclass(frozen=True)
class RawPayload:
    """Whatever a source hands back before parsing.

    Deliberately opaque: a file path + bytes for a drop, an HTTP response body for a
    scraper, a decoded JSON blob for an API. `content` is untyped on purpose so a single
    return type spans all source shapes.
    """

    source_id: str
    source_period: str
    source_file: str
    content: object = None
    meta: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class ValidationResult:
    """Outcome of an adapter's own pre-flight checks on the rows it parsed.

    This is the adapter's self-check. The pipeline-level validation *gates*
    (pipeline/validate/gates.py) are a separate, cross-cutting layer that also runs.
    """

    ok: bool
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @classmethod
    def passing(cls) -> ValidationResult:
        return cls(ok=True)

    @classmethod
    def failing(cls, errors: list[str]) -> ValidationResult:
        return cls(ok=False, errors=errors)


class SourceAdapter(ABC):
    """Contract every source must satisfy.

    Subclasses set `source_id` and `native_frequency` as class attributes and implement
    the three methods. `native_frequency` is the frequency the source ACTUALLY reports
    (month | quarter | year) — it flows straight onto every emitted ContractRow so a
    quarterly-reported CV figure is never mistaken for a summed one.
    """

    source_id: str
    native_frequency: str

    @abstractmethod
    def fetch(self, period: str) -> RawPayload:
        """Acquire the raw source data as-of `period` (e.g. '2026-06')."""
        raise NotImplementedError

    @abstractmethod
    def parse(self, raw: RawPayload) -> list[ContractRow]:
        """Turn a RawPayload into tidy contract rows (one per observation)."""
        raise NotImplementedError

    @abstractmethod
    def validate(self, rows: list[ContractRow]) -> ValidationResult:
        """Adapter-level pre-flight sanity checks on parsed rows."""
        raise NotImplementedError
