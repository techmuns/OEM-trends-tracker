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


def test_gates_registered() -> None:
    names = [g.name for g in REGISTERED_GATES]
    assert names == [
        "schema_conformance",
        "totals_reconciliation",
        "source_seam_check",
        "row_count_delta",
        "value_range_sanity",
        "period_continuity",
        "revision_detection",
    ]


def test_clean_fixture_is_accepted(bundle) -> None:
    # the synthetic fixture (no reconciliation data, no industry-total series, no previous
    # run) should pass/skip every gate and be accepted.
    report = run_gates(GateContext(rows=bundle.rows))
    assert report.accepted is True
    assert not report.failures
    assert "ACCEPTED" in report.summary()
    by_name = {r.name: r.status for r in report.results}
    assert by_name["schema_conformance"] is GateStatus.PASS
    assert by_name["totals_reconciliation"] is GateStatus.SKIP  # no recon data on fixture


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
