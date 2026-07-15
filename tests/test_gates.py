"""Validation-gate framework: it runs, reports, and enforces the accept/quarantine rule."""

from __future__ import annotations

from pathlib import Path

from pipeline.validate.gates import (
    REGISTERED_GATES,
    GateContext,
    GateResult,
    GateStatus,
    quarantine_path,
    run_gates,
)


def test_six_gates_registered() -> None:
    names = [g.name for g in REGISTERED_GATES]
    assert names == [
        "schema_conformance",
        "totals_reconciliation",
        "row_count_delta",
        "value_range_sanity",
        "period_continuity",
        "revision_detection",
    ]


def test_stub_run_accepts_and_all_skip(bundle) -> None:
    report = run_gates(GateContext(rows=bundle.rows))
    assert report.accepted is True
    assert all(r.status is GateStatus.SKIP for r in report.results)
    assert "ACCEPTED" in report.summary()


def test_a_failing_gate_quarantines() -> None:
    class _Failing:
        name = "always_fails"

        def run(self, ctx: GateContext) -> GateResult:  # noqa: ARG002
            return GateResult(self.name, GateStatus.FAIL, "boom")

    report = run_gates(GateContext(rows=[]), gates=[_Failing()])
    assert report.accepted is False
    assert report.failures and report.failures[0].name == "always_fails"
    assert "QUARANTINED" in report.summary()


def test_passing_gate_accepts() -> None:
    class _Passing:
        name = "ok"

        def run(self, ctx: GateContext) -> GateResult:  # noqa: ARG002
            return GateResult(self.name, GateStatus.PASS)

    assert run_gates(GateContext(rows=[]), gates=[_Passing()]).accepted is True


def test_quarantine_path() -> None:
    p = quarantine_path("data/raw/Auto_Database.xlsx", Path("data/raw/quarantine"))
    assert p == Path("data/raw/quarantine/Auto_Database.xlsx")
