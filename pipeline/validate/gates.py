"""Validation-gate framework + registry.

Hard requirement: zero humans in the loop. There is no ingest preview and no manual
approval. The gates decide automatically:

  * all gates pass (or skip)  -> ACCEPT: write snapshot, rebuild bundle, deploy.
  * any gate FAILS            -> QUARANTINE the payload, keep the last good bundle live,
                                 and fail loudly (a GitHub Actions failure IS the alert).

Never let a bad file silently poison the store, and never let a bad file take the live
dashboard down.

Phase 0 ships the FRAMEWORK ONLY — the gate protocol, the result type, the runner, and
the quarantine path. The six gates are registered as named stubs that return SKIP; their
real logic lands in Phase 1. Adding real logic later means only replacing a stub's `run`.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Protocol, runtime_checkable

from pipeline.contract.models import ContractRow

QUARANTINE_DIR = Path("data/raw/quarantine")


class GateStatus(StrEnum):
    PASS = "pass"
    FAIL = "fail"
    SKIP = "skip"  # gate not applicable, or (Phase 0) not yet implemented


@dataclass(frozen=True)
class GateResult:
    name: str
    status: GateStatus
    message: str = ""
    details: dict[str, object] = field(default_factory=dict)

    @property
    def failed(self) -> bool:
        return self.status is GateStatus.FAIL


@dataclass
class GateContext:
    """Everything a gate might need. Kept loose in Phase 0; gates read what they use.

    `rows` are the freshly-parsed candidate rows. `previous_rows` is the last accepted
    store (for delta / revision / continuity gates). `extras` carries run metadata.
    """

    rows: Sequence[ContractRow]
    previous_rows: Sequence[ContractRow] = ()
    extras: dict[str, object] = field(default_factory=dict)


@runtime_checkable
class Gate(Protocol):
    name: str

    def run(self, ctx: GateContext) -> GateResult: ...


@dataclass(frozen=True)
class RunReport:
    """Aggregate outcome of a gate run and the resulting accept/quarantine decision."""

    results: list[GateResult]
    accepted: bool

    @property
    def failures(self) -> list[GateResult]:
        return [r for r in self.results if r.failed]

    def summary(self) -> str:
        counts: dict[GateStatus, int] = {}
        for r in self.results:
            counts[r.status] = counts.get(r.status, 0) + 1
        parts = ", ".join(f"{s.value}={counts.get(s, 0)}" for s in GateStatus)
        verdict = "ACCEPTED" if self.accepted else "QUARANTINED"
        return f"[{verdict}] gates: {parts}"


# --- Stub gates (Phase 0). Each returns SKIP; real logic lands in Phase 1. ------------


@dataclass(frozen=True)
class _StubGate:
    name: str
    intent: str

    def run(self, ctx: GateContext) -> GateResult:  # noqa: ARG002 - ctx unused in stub
        return GateResult(
            name=self.name,
            status=GateStatus.SKIP,
            message=f"stub: {self.intent} (logic lands in Phase 1)",
        )


# The registry. Order is the run order.
REGISTERED_GATES: list[Gate] = [
    _StubGate("schema_conformance", "every row validates against the contract schema"),
    _StubGate("totals_reconciliation", "company rows sum to the reported total row"),
    _StubGate("row_count_delta", "row count is within expected range vs last run"),
    _StubGate("value_range_sanity", "no negatives, no absurd magnitude jumps"),
    _StubGate("period_continuity", "no unexplained missing months"),
    _StubGate("revision_detection", "flag when a prior period's value changed"),
]


def run_gates(ctx: GateContext, gates: Iterable[Gate] | None = None) -> RunReport:
    """Run every gate and decide accept vs quarantine.

    Decision rule: ACCEPT iff no gate FAILED (SKIP and PASS both allow acceptance). Any
    FAIL means the whole payload is rejected — callers must then quarantine and fail loudly.
    """
    chosen = list(REGISTERED_GATES if gates is None else gates)
    results = [g.run(ctx) for g in chosen]
    accepted = not any(r.failed for r in results)
    return RunReport(results=results, accepted=accepted)


def quarantine_path(source_file: str, quarantine_dir: Path = QUARANTINE_DIR) -> Path:
    """Where a rejected payload is parked. Real move/copy happens in the Phase-1 runner."""
    return quarantine_dir / Path(source_file).name
